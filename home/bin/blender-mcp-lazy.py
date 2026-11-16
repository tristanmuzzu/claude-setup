#!/usr/bin/env python3
"""Lazy front for the official Blender MCP server.

Problem it solves: a normal MCP server puts its instructions and every tool name
into every chat, even chats that never touch Blender. This proxy starts with a
single tool, `blender_activate`, and no instructions. When a chat calls it, the
proxy launches the real Blender MCP for that chat only, returns the real
server's instructions as the tool result, announces the real tools with
`notifications/tools/list_changed`, and from then on forwards every call.

Each Claude session spawns its own copy of this process, so activation is
per chat. Run it with the Blender MCP venv's Python (it needs the `mcp` SDK).
"""

from __future__ import annotations

import os
import sys

import anyio
from mcp import ClientSession, types
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.server.lowlevel import NotificationOptions, Server
from mcp.server.stdio import stdio_server

_VENV = os.path.expanduser("~/.claude/blender-mcp/.venv")
UPSTREAM = os.environ.get(
    "BLENDER_MCP_UPSTREAM",
    os.path.join(_VENV, "Scripts", "blender-mcp.exe") if os.name == "nt"
    else os.path.join(_VENV, "bin", "blender-mcp"),
)

ACTIVATE = types.Tool(
    name="blender_activate",
    description=(
        "Load the Blender tools (scene inspection, bpy code execution, screenshots, "
        "API and manual search) and their usage instructions into this chat only. "
        "Call once before any Blender work; Blender must be running with the MCP add-on."
    ),
    inputSchema={"type": "object", "properties": {}},
)


class Upstream:
    def __init__(self) -> None:
        self.session: ClientSession | None = None
        self.tools: list[types.Tool] = []
        self.instructions: str = ""
        self.ready = anyio.Event()
        self.error: BaseException | None = None
        self.lock = anyio.Lock()
        self.started = False

    async def run(self) -> None:
        """Owns the upstream connection for the life of this process."""
        try:
            params = StdioServerParameters(command=UPSTREAM, args=[], env=dict(os.environ))
            async with stdio_client(params, errlog=sys.stderr) as (r, w):
                async with ClientSession(r, w) as session:
                    init = await session.initialize()
                    self.instructions = init.instructions or ""
                    self.tools = (await session.list_tools()).tools
                    self.session = session
                    self.ready.set()
                    await anyio.sleep_forever()
        except BaseException as exc:  # surfaced to the caller of blender_activate
            self.error = exc
            self.ready.set()
            raise


server: Server = Server("blender")
upstream = Upstream()
task_group: anyio.abc.TaskGroup | None = None


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [ACTIVATE, *upstream.tools]


def _text(msg: str, error: bool = False) -> types.CallToolResult:
    return types.CallToolResult(content=[types.TextContent(type="text", text=msg)], isError=error)


@server.call_tool(validate_input=False)
async def call_tool(name: str, arguments: dict | None):
    if name == "blender_activate":
        async with upstream.lock:
            if not upstream.started:
                upstream.started = True
                assert task_group is not None
                task_group.start_soon(upstream.run)
            with anyio.move_on_after(60):
                await upstream.ready.wait()
        if upstream.error or upstream.session is None:
            upstream.started = False
            upstream.ready = anyio.Event()
            return _text(f"Blender MCP failed to start: {upstream.error!r}", error=True)
        await server.request_context.session.send_tool_list_changed()
        names = ", ".join(t.name for t in upstream.tools)
        return _text(
            "Blender tools are now loaded for this chat (search them with ToolSearch if they "
            f"are deferred): {names}\n\n--- Blender MCP instructions ---\n{upstream.instructions}"
        )

    if upstream.session is None:
        return _text("Blender tools are not loaded yet. Call blender_activate first.", error=True)
    return await upstream.session.call_tool(name, arguments or {})


async def main() -> None:
    global task_group
    async with anyio.create_task_group() as tg:
        task_group = tg
        async with stdio_server() as (r, w):
            await server.run(
                r,
                w,
                server.create_initialization_options(
                    notification_options=NotificationOptions(tools_changed=True)
                ),
            )
        tg.cancel_scope.cancel()


if __name__ == "__main__":
    anyio.run(main)

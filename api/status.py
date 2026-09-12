"""Status endpoint for Chat Status Lights.

Route: POST /api/plugins/chat_status_lights/status
Actions:
- errors: {"action": "errors"} -> {"ok": true, "errors": {context_id: true}}

A chat is flagged when its log shows an error-type entry after the most
recent response-type entry, meaning the last visible turn ended in error.
Running chats are never flagged; the flag clears itself once the chat runs
and produces a new response.
"""

from __future__ import annotations

from agent import AgentContext, AgentContextType
from helpers.api import ApiHandler, Input, Output, Request, Response


class Status(ApiHandler):
    async def process(self, input: Input, request: Request) -> Output:
        action = str(input.get("action", "") or "").strip().lower()
        if action != "errors":
            return Response(status=400, response=f"Unknown action: {action}")

        errors: dict[str, bool] = {}
        for ctx in AgentContext.all():
            if ctx.type == AgentContextType.BACKGROUND or ctx.is_running():
                continue
            try:
                items = ctx.log.output().items
            except Exception:
                continue
            last_response = -1
            for i, item in enumerate(items):
                if getattr(item, "type", None) == "response":
                    last_response = i
            tail = items[last_response + 1 :]
            if any(getattr(item, "type", None) == "error" for item in tail):
                errors[ctx.id] = True

        return {"ok": True, "errors": errors}

# Research: cách làm extension cho Pi CLI

**Ngày:** 2026-04-17  
**Workspace:** `/Users/vu.le/Projects/pi-harness-extension`

## 1. Kết luận nhanh

Pi CLI hỗ trợ **extension bằng TypeScript**, không cần build trước, vì runtime load qua **jiti**.

Bạn có thể làm extension theo 3 cách chính:

1. **Extension local cho toàn máy**
   - đặt file ở `~/.pi/agent/extensions/*.ts`
2. **Extension local theo project**
   - đặt file ở `.pi/extensions/*.ts`
3. **Đóng gói thành Pi package** để chia sẻ qua npm/git
   - khai báo trong `package.json` dưới key `pi`
   - cài bằng `pi install npm:@scope/pkg` hoặc thêm vào `settings.json`

Core API của extension cho phép:
- hook lifecycle/event: `session_start`, `tool_call`, `before_agent_start`, `input`, ...
- thêm command: `pi.registerCommand()`
- thêm tool cho model gọi: `pi.registerTool()`
- UI tương tác: `ctx.ui.confirm/select/input/editor/notify/...`
- can thiệp tool result, provider payload, model/provider, session tree, reload runtime
- lưu state qua session entries/tool result `details`

## 2. Nguồn research đã dùng

Do web search trong môi trường này chưa được cấu hình, research được thực hiện từ **source/docs local** trong repo lân cận `pi-gui`, đặc biệt là package:

- `pi-gui/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/docs/packages.md`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/docs/settings.md`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/examples/extensions/*`
- `pi-gui/apps/desktop/tests/live/*.spec.ts`
- `pi-gui/packages/pi-sdk-driver/src/*`

Các tài liệu này đủ để xác định khá chắc cách extension của **Pi CLI / pi-coding-agent** hoạt động.

## 3. Cách Pi CLI load extension

### 3.1 Auto-discovery

Pi tự tìm extension ở các vị trí:

- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`
- `.pi/extensions/*.ts`
- `.pi/extensions/*/index.ts`

### 3.2 Load tạm thời để test

Có thể chạy nhanh:

```bash
pi -e ./my-extension.ts
```

Docs ghi rõ: dùng `-e` chỉ nên để test nhanh; muốn hỗ trợ `/reload` ổn định thì nên đặt extension vào thư mục auto-discovery.

### 3.3 Khai báo qua settings

Trong `~/.pi/agent/settings.json` hoặc `.pi/settings.json`:

```json
{
  "extensions": [
    "/absolute/path/to/my-extension.ts"
  ]
}
```

Hoặc dùng package:

```json
{
  "packages": [
    "npm:@scope/pi-package"
  ]
}
```

## 4. Skeleton tối thiểu của một extension

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("My extension loaded", "info");
  });

  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

## 5. Quickstart thực tế

### Bước 1: tạo project-local extension

```bash
mkdir -p .pi/extensions
cat > .pi/extensions/hello.ts <<'TS'
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function hello(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("hello extension loaded", "info");
  });

  pi.registerCommand("hello", {
    description: "Say hello from extension",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}`, "info");
    },
  });
}
TS
```

### Bước 2: mở Pi CLI trong project đó

```bash
pi
```

### Bước 3: gọi command

```text
/hello
/hello Vu
```

### Bước 4: reload khi sửa code

```text
/reload
```

## 6. Những API chính bạn sẽ dùng

## 6.1 Event hooks: `pi.on(...)`

Từ docs local, Pi CLI cho hook vào nhiều event quan trọng:

- `session_start`
- `session_before_switch`, `session_switch`
- `session_before_fork`, `session_fork`
- `session_before_compact`, `session_compact`
- `session_before_tree`, `session_tree`
- `session_shutdown`
- `before_agent_start`
- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `tool_call`
- `tool_result`
- `before_provider_request`
- `input`
- `model_select`
- `user_bash`

### Ví dụ chặn lệnh bash nguy hiểm

```ts
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
    const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
    if (!ok) return { block: true, reason: "Blocked by user" };
  }
});
```

## 6.2 Command: `pi.registerCommand()`

Dùng để tạo slash command như `/hello`, `/review`, `/deploy`.

```ts
pi.registerCommand("review", {
  description: "Run review helper",
  handler: async (args, ctx) => {
    ctx.ui.notify(`Review target: ${args}`, "info");
  },
});
```

Có hỗ trợ autocomplete cho argument:

```ts
pi.registerCommand("deploy", {
  description: "Deploy to env",
  getArgumentCompletions: (prefix) => {
    const envs = ["dev", "staging", "prod"];
    const items = envs
      .filter((e) => e.startsWith(prefix))
      .map((e) => ({ value: e, label: e }));
    return items.length ? items : null;
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`Deploy ${args}`, "info");
  },
});
```

## 6.3 Tool: `pi.registerTool()`

Đây là phần quan trọng nhất nếu bạn muốn model gọi capability riêng.

```ts
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "greet",
  label: "Greet",
  description: "Greet someone",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Hello, ${params.name}!` }],
      details: { greeted: params.name },
    };
  },
});
```

### Lưu ý quan trọng

- Nếu tool báo lỗi, **throw error**, không phải return cờ lỗi.
- Nếu tool chạm vào file, nên dùng queue/mutation discipline để tránh race condition.
- Nếu dùng enum string, docs khuyên dùng `StringEnum` từ `@mariozechner/pi-ai` cho tương thích tốt hơn với một số provider.

## 6.4 UI trong extension: `ctx.ui`

Pi CLI cho khá nhiều primitive để hỏi user hoặc cập nhật UI:

- `ctx.ui.confirm(title, message)`
- `ctx.ui.select(title, options)`
- `ctx.ui.input(title, placeholder)`
- `ctx.ui.editor(title, initialValue)`
- `ctx.ui.notify(message, level)`
- `ctx.ui.setStatus(key, text)`
- `ctx.ui.setWidget(key, lines, options)`
- `ctx.ui.setTitle(title)`
- `ctx.ui.setEditorText(text)`
- `ctx.ui.custom(...)`

### Ví dụ dialog đơn giản

```ts
pi.registerCommand("ask-name", {
  description: "Ask for name",
  handler: async (_args, ctx) => {
    const name = await ctx.ui.input("Your name", "type here");
    if (!name) return;
    ctx.ui.notify(`Hello ${name}`, "info");
  },
});
```

### Ví dụ set text vào editor

```ts
pi.registerCommand("draft", {
  description: "Prefill editor",
  handler: async (_args, ctx) => {
    ctx.ui.setEditorText("Draft content from extension");
  },
});
```

## 6.5 Gửi message vào session

- `pi.sendMessage(...)` để inject custom message
- `pi.sendUserMessage(...)` để gửi như user thật

Ví dụ:

```ts
pi.sendUserMessage("Please continue with error handling", { deliverAs: "followUp" });
```

## 6.6 Quản lý model/provider/tool runtime

Theo docs local, extension có thể:

- `pi.getAllTools()`
- `pi.getActiveTools()`
- `pi.setActiveTools([...])`
- `pi.setModel(model)`
- `pi.getThinkingLevel()`
- `pi.setThinkingLevel(level)`
- `pi.registerProvider(...)`
- `pi.unregisterProvider(...)`

Điều này cho phép làm các extension kiểu:
- preset mode
- read-only mode
- custom provider
- switch model / thinking preset

## 7. State management đúng cách

Docs nhấn mạnh: nếu extension có state, tốt nhất **lưu state vào tool result `details`** hoặc session entries, thay vì một file riêng vô nghĩa với branching.

Pattern chuẩn:

1. Tool return `details` chứa state mới
2. Khi `session_start/session_switch/session_fork/session_tree`, scan branch hiện tại
3. Reconstruct in-memory state từ history

Ví dụ từ `todo.ts`:
- state todo list được rebuild từ các toolResult trước đó
- vì vậy khi fork/tree, state tự đúng theo nhánh đang đứng

Đây là design rất đáng follow nếu extension của bạn có “memory”.

## 8. Cách đóng gói thành package để chia sẻ

## 8.1 `package.json`

```json
{
  "name": "my-pi-package",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Nếu không có key `pi`, Pi vẫn có thể auto-discover theo convention:

- `extensions/`
- `skills/`
- `prompts/`
- `themes/`

## 8.2 Cài package

```bash
pi install npm:@scope/my-pi-package
```

hoặc project-local:

```bash
pi install -l npm:@scope/my-pi-package
```

## 8.3 settings package source

```json
{
  "packages": [
    "npm:@scope/my-pi-package"
  ]
}
```

## 9. Cấu trúc thư mục đề xuất

### Option A: extension đơn file

```text
.pi/
  extensions/
    hello.ts
```

### Option B: extension nhiều file

```text
.pi/
  extensions/
    my-extension/
      index.ts
      tools.ts
      utils.ts
```

### Option C: package chia sẻ qua npm

```text
my-pi-package/
  package.json
  extensions/
    review.ts
    presets/
      index.ts
  skills/
  prompts/
  themes/
```

## 10. Ví dụ các use case phù hợp

Từ docs/examples local, Pi extension thường được dùng cho:

- permission gate trước khi chạy `bash`
- path protection (`.env`, `.git`, `node_modules`)
- tool mới cho LLM
- override built-in tool
- interactive command / wizard
- custom provider
- plan mode
- handoff sang session mới
- summary/compaction custom
- widgets/status line cho UI
- gửi user message follow-up/steer

## 11. Giới hạn và lưu ý quan trọng

### 11.1 Quyền rất mạnh

Docs ghi rõ: extension chạy với **full system permissions**. Chỉ cài extension/package từ nguồn tin cậy.

### 11.2 `ctx.ui.custom()` là TUI mạnh nhưng host khác nhau hỗ trợ khác nhau

Trong **Pi CLI terminal**, `ctx.ui.custom()` là feature mạnh để render TUI riêng.

Nhưng từ local code `pi-gui`, mình thấy host GUI không render generic `custom()` mà sẽ báo kiểu “terminal-only”. Nghĩa là:

- viết cho **Pi CLI terminal**: dùng `custom()` thoải mái
- nếu muốn chạy tốt trên host GUI/embedded app: nên ưu tiên `confirm/select/input/editor/notify/setEditorText/...`

### 11.3 `/reload`

Nếu muốn hot reload tốt:
- ưu tiên đặt extension trong thư mục auto-discovery
- `-e ./file.ts` chỉ tiện cho test nhanh

### 11.4 Extension command chạy trước skill/template expansion

Theo docs, thứ tự xử lý input là:
1. extension commands
2. `input` hook
3. skill expansion
4. prompt template expansion
5. agent run

Nên nếu bạn tạo slash command, nó có priority khá cao.

## 12. Nếu muốn làm extension tương thích pi-gui / host app

Từ code local `pi-gui`, mình rút ra thêm mấy điểm:

- project extension được test bằng cách đặt file ở `.pi/extensions/*.ts`
- GUI host map một số API UI sang dialog/native UI:
  - `confirm`
  - `select`
  - `input`
  - `editor`
  - `notify`
  - `setStatus`
  - `setWidget`
  - `setTitle`
  - `setEditorText`
- `ctx.ui.custom()` hiện bị coi là **terminal-only** trong pi-gui
- một số package npm như `@tungthedev/pi-extensions` được GUI map thêm “native surfaces”, nhưng đây là **logic host-specific**, không phải core API public của Pi CLI

=> Nếu mục tiêu là “extension cho Pi CLI” thì cứ theo `docs/extensions.md`. Nếu mục tiêu là “vừa chạy Pi CLI vừa chạy pi-gui”, hãy tránh phụ thuộc vào `custom()` quá nhiều.

## 13. Mẫu extension khởi đầu nên dùng

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function starter(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("starter", "Starter loaded");
  });

  pi.registerCommand("starter-draft", {
    description: "Insert starter draft into editor",
    handler: async (_args, ctx) => {
      ctx.ui.setEditorText("Write a concise implementation plan here...");
      ctx.ui.notify("Draft inserted", "info");
    },
  });

  pi.registerTool({
    name: "starter_echo",
    label: "Starter Echo",
    description: "Echo text back to the model",
    parameters: Type.Object({
      text: Type.String({ description: "Text to echo" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Echo: ${params.text}` }],
        details: { echoed: params.text },
      };
    },
  });
}
```

## 14. Roadmap đề xuất nếu bạn muốn tự build một extension thật

1. **Bắt đầu bằng project-local extension** trong `.pi/extensions/`
2. Chỉ làm **1 command nhỏ** trước
3. Sau đó thêm **1 tool nhỏ**
4. Nếu cần state, lưu trong `details` + reconstruct từ session
5. Nếu cần UX, dùng `input/select/editor/notify`
6. Nếu extension ổn, đóng gói thành npm package với key `pi`
7. Nếu muốn tương thích GUI host, tránh phụ thuộc hoàn toàn vào `ctx.ui.custom()`

## 15. Checklist để bắt đầu ngay

- [ ] Có cài `pi` CLI chưa
- [ ] Tạo `.pi/extensions/my-extension.ts`
- [ ] Export `default function (pi)`
- [ ] Thêm `pi.registerCommand()` trước
- [ ] Chạy `pi`
- [ ] Test command `/...`
- [ ] Sửa file và chạy `/reload`
- [ ] Nếu cần model gọi capability, thêm `pi.registerTool()`
- [ ] Nếu muốn chia sẻ, tạo `package.json` với key `pi`

## 16. Tóm tắt 1 câu

**Cách chuẩn để làm extension cho Pi CLI là viết một file TypeScript export default function nhận `ExtensionAPI`, đặt nó vào `~/.pi/agent/extensions/` hoặc `.pi/extensions/`, rồi dùng `pi.on`, `pi.registerCommand`, `pi.registerTool`, và `ctx.ui` để mở rộng hành vi của Pi.**

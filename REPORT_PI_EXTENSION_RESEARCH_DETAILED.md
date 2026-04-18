# Báo cáo research chi tiết: Cách làm extension cho Pi CLI

**Ngày:** 2026-04-17  
**Thư mục làm việc:** `/Users/vu.le/Projects/pi-harness-extension`

---

## 1. Executive Summary

Pi CLI (cụ thể là runtime `@mariozechner/pi-coding-agent`) hỗ trợ một hệ thống **extension bằng TypeScript** có khả năng mở rộng khá sâu:

- nghe lifecycle events của session/agent/tool
- đăng ký **slash commands** với `pi.registerCommand()`
- đăng ký **custom tools** để model gọi với `pi.registerTool()`
- tương tác với user qua `ctx.ui.*`
- can thiệp vào input, tool calls, tool results, model/provider, compaction, tree navigation
- đóng gói extension thành **Pi package** và phân phối qua npm/git

Cách chuẩn nhất để làm extension:

1. viết một file TypeScript export `default function (pi: ExtensionAPI)`
2. đặt file vào `~/.pi/agent/extensions/` hoặc `.pi/extensions/`
3. chạy `pi`
4. dùng `/reload` khi chỉnh sửa

Nếu muốn share cho người khác, có thể đóng gói thành **Pi package** với key `pi` trong `package.json`, rồi cài bằng `pi install npm:...` hoặc khai báo trong `settings.json`.

Ngoài ra, từ việc đọc code `pi-gui`, có thể kết luận:

- extension của Pi CLI còn có thể được host bởi app khác ngoài terminal
- tuy nhiên **không phải mọi UI API đều portable hoàn toàn**
- các primitive như `confirm/select/input/editor/notify/setEditorText` portable hơn
- `ctx.ui.custom()` hiện có dấu hiệu là **terminal-first** và có thể không được hỗ trợ đầy đủ trong GUI host

---

## 2. Phạm vi research

Yêu cầu: **research về cách làm extension cho Pi CLI** và tạo **file report chi tiết**.

Research này tập trung vào:

1. cách Pi CLI phát hiện và load extension
2. API chính để viết extension
3. cấu trúc package / settings / resource loading
4. best practices khi build extension thực tế
5. lưu ý tương thích khi extension được host ngoài terminal

---

## 3. Nguồn thông tin đã dùng

Do môi trường hiện tại **không có web search provider**, toàn bộ research được thực hiện dựa trên **source/docs local** đã có trên máy.

### 3.1 Tài liệu chính

Các nguồn local quan trọng nhất:

- `pi-gui/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/docs/packages.md`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/docs/settings.md`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/README.md`

### 3.2 Ví dụ thực tế

- `pi-gui/node_modules/@mariozechner/pi-coding-agent/examples/extensions/hello.ts`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/examples/extensions/commands.ts`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/examples/extensions/question.ts`
- `pi-gui/node_modules/@mariozechner/pi-coding-agent/examples/extensions/README.md`

### 3.3 Code host integration (để hiểu extension surfaces ngoài CLI)

- `pi-gui/apps/desktop/tests/live/extensions.spec.ts`
- `pi-gui/apps/desktop/tests/live/extensions-dialogs.spec.ts`
- `pi-gui/apps/desktop/tests/live/extensions-native-surfaces.spec.ts`
- `pi-gui/apps/desktop/tests/live/extension-command-compatibility.spec.ts`
- `pi-gui/apps/desktop/tests/live/extensions-npm-packages.spec.ts`
- `pi-gui/packages/pi-sdk-driver/src/runtime-supervisor.ts`
- `pi-gui/packages/pi-sdk-driver/src/session-supervisor.ts`
- `pi-gui/packages/pi-sdk-driver/src/extension-surface-adapters.ts`
- `pi-gui/apps/desktop/src/composer-commands.ts`

### 3.4 Kết luận về độ tin cậy

Vì research dựa trực tiếp trên docs và source local của runtime/host integration, các kết luận trong báo cáo này có độ tin cậy **khá cao** đối với Pi CLI hiện tại.

---

## 4. Pi CLI extension là gì?

Theo docs local, extension là **TypeScript module** giúp mở rộng behavior của Pi mà không cần fork core runtime.

Extension có thể:

- hook vào event lifecycle
- thêm custom tools cho model
- thêm slash commands
- hiển thị UI tương tác
- kiểm soát an toàn khi tool chạy
- thay đổi system prompt theo ngữ cảnh
- thao tác session/runtime/provider/model
- lưu state và rebuild state khi branch/fork/tree

Nói đơn giản: extension là lớp plug-in chạy **bên trong Pi runtime**, có đặc quyền rất mạnh, và có quyền can thiệp sâu vào cả input lẫn execution.

---

## 5. Cơ chế phát hiện và load extension

## 5.1 Auto-discovery locations

Pi CLI tự động load extension từ các path sau:

### Global

- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`

### Project-local

- `.pi/extensions/*.ts`
- `.pi/extensions/*/index.ts`

Đây là cách nên dùng nếu muốn extension:

- tự được load mỗi lần mở Pi
- hoạt động ổn với `/reload`
- dễ quản lý theo project hoặc theo máy

## 5.2 Load tạm thời để test

Có thể test nhanh extension bằng:

```bash
pi -e ./my-extension.ts
```

Hoặc:

```bash
pi --extension ./my-extension.ts
```

Docs local nhấn mạnh: cách này phù hợp cho **quick test**, không phải đường chính cho workflow dài hạn.

## 5.3 Load qua settings

Ngoài auto-discovery, có thể khai báo extension path trực tiếp trong settings.

### Global settings

- `~/.pi/agent/settings.json`

### Project settings

- `.pi/settings.json`

Ví dụ:

```json
{
  "extensions": [
    "/absolute/path/to/my-extension.ts"
  ]
}
```

---

## 6. Runtime model: extension chạy như thế nào?

Từ docs `extensions.md` và `sdk.md`, có thể tóm tắt runtime model như sau:

1. Pi khởi động runtime/session
2. Resource loader phát hiện extensions, skills, prompts, themes
3. Extension module được load bằng runtime loader
4. Extension export default function được gọi với `pi: ExtensionAPI`
5. Extension đăng ký hooks/tools/commands/flags/shortcuts
6. Khi user prompt hoặc lifecycle event diễn ra, handler tương ứng được gọi

### Điểm quan trọng

- Extension **không cần compile trước** theo cách truyền thống; TypeScript được load qua runtime tooling
- Extension chạy **với full system permissions**
- Extension có thể ảnh hưởng trực tiếp tới session behavior

---

## 7. Extension entrypoint chuẩn

Mẫu entrypoint cơ bản:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI) {
  // register hooks, commands, tools...
}
```

Nếu dùng nhiều file, entrypoint thường là `index.ts`.

---

## 8. API cốt lõi của extension

## 8.1 `pi.on(event, handler)`

Đây là API để hook vào lifecycle và execution pipeline.

### Nhóm session events

- `session_start`
- `session_before_switch`
- `session_switch`
- `session_before_fork`
- `session_fork`
- `session_before_compact`
- `session_compact`
- `session_before_tree`
- `session_tree`
- `session_shutdown`
- `session_directory` (CLI startup only)

### Nhóm agent/message/tool events

- `before_agent_start`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `tool_call`
- `tool_result`
- `before_provider_request`
- `input`
- `model_select`
- `user_bash`

### Ý nghĩa thực tế

Nhờ các hooks này, extension có thể:

- chặn lệnh nguy hiểm trước khi tool chạy
- inject instructions trước mỗi turn
- transform input của user
- sửa kết quả tool trước khi model thấy
- custom compaction
- custom tree navigation
- theo dõi model/provider switching

### Ví dụ: chặn lệnh bash nguy hiểm

```ts
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
    const ok = await ctx.ui.confirm("Dangerous command", "Allow rm -rf?");
    if (!ok) {
      return { block: true, reason: "Blocked by extension" };
    }
  }
});
```

### Ví dụ: append extra context trước agent run

```ts
pi.on("before_agent_start", async (event, ctx) => {
  return {
    systemPrompt: event.systemPrompt + "\n\nAlways summarize risks before editing files.",
  };
});
```

---

## 8.2 `pi.registerCommand(name, options)`

API này dùng để tạo slash commands kiểu:

- `/hello`
- `/review`
- `/deploy`
- `/preset`

### Ví dụ tối thiểu

```ts
pi.registerCommand("hello", {
  description: "Say hello",
  handler: async (args, ctx) => {
    ctx.ui.notify(`Hello ${args || "world"}!`, "info");
  },
});
```

### Hỗ trợ autocomplete arguments

```ts
pi.registerCommand("deploy", {
  description: "Deploy to environment",
  getArgumentCompletions: (prefix) => {
    const envs = ["dev", "staging", "prod"];
    const items = envs
      .filter((e) => e.startsWith(prefix))
      .map((e) => ({ value: e, label: e }));
    return items.length > 0 ? items : null;
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`Deploying to ${args}`, "info");
  },
});
```

### Ghi chú quan trọng

- extension commands được kiểm tra **trước** skill/template expansion
- nếu command match, nó có thể bypass phần input pipeline thông thường
- nếu nhiều extension đăng ký cùng tên, docs cho biết Pi sẽ gán suffix kiểu `:1`, `:2`

---

## 8.3 `pi.registerTool(definition)`

Đây là API mạnh nhất khi bạn muốn **thêm capability mới cho model**.

Model có thể gọi tool này giống như gọi built-in tools (`read`, `write`, `bash`, ...).

### Ví dụ tối thiểu

```ts
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "greet",
  label: "Greet",
  description: "Greet someone by name",
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

### Các field đáng chú ý

- `name`: tên tool mà model sẽ gọi
- `label`: label UI
- `description`: mô tả cho model
- `parameters`: schema input
- `execute(...)`: hàm chạy tool
- `renderCall(...)`, `renderResult(...)`: custom rendering tùy chọn
- `promptSnippet`, `promptGuidelines`: hỗ trợ prompt system

### Best practices từ docs/examples

1. **throw error** để báo lỗi tool đúng chuẩn
2. đưa state quan trọng vào `details`
3. nếu tool mutate file, cần cẩn thận chuyện race condition
4. nếu dùng enum string, docs khuyên dùng `StringEnum` cho tương thích rộng hơn

### Ví dụ với `StringEnum`

```ts
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

const Params = Type.Object({
  action: StringEnum(["list", "add"] as const),
  text: Type.Optional(Type.String()),
});
```

---

## 8.4 UI APIs: `ctx.ui.*`

Extension có thể tương tác với user bằng các API UI sau:

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

### Ví dụ: input dialog

```ts
pi.registerCommand("ask-name", {
  description: "Ask user name",
  handler: async (_args, ctx) => {
    const name = await ctx.ui.input("Your name", "type here");
    if (!name) return;
    ctx.ui.notify(`Hello ${name}`, "info");
  },
});
```

### Ví dụ: editor dialog

```ts
pi.registerCommand("edit-note", {
  description: "Open editor",
  handler: async (_args, ctx) => {
    const value = await ctx.ui.editor("Edit note", "Line 1");
    if (!value) return;
    ctx.ui.notify(`Saved ${value.split("\n").length} lines`, "info");
  },
});
```

### Ví dụ: set text vào editor chính

```ts
pi.registerCommand("draft", {
  description: "Prefill editor",
  handler: async (_args, ctx) => {
    ctx.ui.setEditorText("Draft generated by extension");
  },
});
```

### `ctx.ui.custom()`

Đây là API để render **TUI tùy chỉnh** trong terminal host. Ví dụ `question.ts` cho thấy có thể build:

- menu chọn options
- editor inline
- keyboard navigation
- custom rendering

Tuy nhiên, từ code `pi-gui` có thể thấy host GUI hiện **không generic-render** `custom()` mà coi nó là **terminal-only**.

=> Nếu extension chỉ phục vụ Pi CLI terminal: `custom()` rất mạnh.  
=> Nếu muốn cross-host: nên ưu tiên primitives đơn giản hơn.

---

## 8.5 Session/runtime control APIs

Từ docs `extensions.md`, command context có thể truy cập thêm các control API như:

- `ctx.waitForIdle()`
- `ctx.newSession(options?)`
- `ctx.fork(entryId)`
- `ctx.navigateTree(targetId, options?)`
- `ctx.reload()`

Các API này hữu ích để viết command như:

- handoff sang session mới
- branch review
- auto fork
- runtime reload helper

### Ví dụ: tạo session mới từ command

```ts
pi.registerCommand("handoff", {
  description: "Create focused new session",
  handler: async (args, ctx) => {
    const result = await ctx.newSession();
    if (result.cancelled) return;
    ctx.ui.setEditorText(`Continue working on: ${args}`);
  },
});
```

---

## 8.6 Message/session utilities

### `pi.sendMessage(...)`

Inject custom message vào session.

### `pi.sendUserMessage(...)`

Gửi một user message như thể user vừa nhập vào editor.

Ví dụ:

```ts
pi.sendUserMessage("Please continue with error handling", { deliverAs: "followUp" });
```

### `pi.appendEntry(...)`

Dùng để persist custom session entries.

### `pi.setSessionName(name)` / `pi.getSessionName()`

Đặt hoặc đọc session title.

### `pi.setLabel(entryId, label)`

Gắn label cho entry trong session tree.

---

## 8.7 Model/provider/tools management

Docs cho thấy extension còn có thể đụng vào runtime layer:

- `pi.getActiveTools()`
- `pi.getAllTools()`
- `pi.setActiveTools(names)`
- `pi.setModel(model)`
- `pi.getThinkingLevel()`
- `pi.setThinkingLevel(level)`
- `pi.registerProvider(name, config)`
- `pi.unregisterProvider(name)`
- `pi.getCommands()`

Điều này cho phép build:

- preset mode
- read-only mode
- provider wrapper/proxy
- model switch extension
- skill/tool toggles

---

## 9. Thứ tự pipeline input/runtime đáng chú ý

Theo docs local, flow xử lý input có thứ tự quan trọng:

1. extension commands được check trước
2. `input` event chạy
3. nếu chưa handled thì skill commands được expand
4. nếu chưa handled thì prompt templates được expand
5. mới tới agent loop

Hệ quả thiết kế:

- slash command extension có priority cao
- hook `input` có thể rewrite user input trước khi model thấy
- skill/template không phải lúc nào cũng được chạm đến nếu extension đã intercept

---

## 10. State management: cách làm đúng

Đây là điểm rất quan trọng mà docs/examples làm khá rõ.

### 10.1 Anti-pattern

Không nên chỉ lưu state vào biến memory thuần hoặc file ngoài một cách tùy tiện, vì:

- session có branching
- tree navigation có thể quay về điểm cũ
- fork có thể tạo nhánh mới
- state ngoài session history rất dễ lệch với branch hiện tại

### 10.2 Pattern đúng

Lưu state trong:

- tool result `details`
- custom session entries

và reconstruct state bằng cách scan branch hiện tại khi:

- `session_start`
- `session_switch`
- `session_fork`
- `session_tree`

### 10.3 Ví dụ từ `todo.ts`

Flow trong `todo.ts`:

1. mỗi lần tool `todo` chạy, nó return `details` chứa toàn bộ state mới
2. khi session đổi branch, extension scan tool results trên branch hiện tại
3. rebuild state todos từ history

### 10.4 Vì sao pattern này tốt?

- branch nào state branch đó
- fork giữ state đúng tại thời điểm fork
- không cần external database cho state nhỏ
- logic bám sát session reality

---

## 11. Packaging: đóng gói extension thành Pi package

## 11.1 Package manifest trong `package.json`

Ví dụ:

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

### Ý nghĩa

Package có thể bundle nhiều resource types:

- extensions
- skills
- prompts
- themes

## 11.2 Convention directories

Nếu không khai báo `pi` manifest, Pi vẫn có thể auto-discover theo convention:

- `extensions/`
- `skills/`
- `prompts/`
- `themes/`

## 11.3 Install package

```bash
pi install npm:@scope/my-pi-package
```

Hoặc project-local:

```bash
pi install -l npm:@scope/my-pi-package
```

## 11.4 Package sources

Pi chấp nhận các dạng source:

- `npm:@scope/pkg@1.2.3`
- `git:github.com/user/repo@v1`
- `https://github.com/user/repo`
- local path tuyệt đối/tương đối

## 11.5 settings với `packages`

```json
{
  "packages": [
    "npm:@scope/my-pi-package"
  ]
}
```

Hoặc filter resource trong package:

```json
{
  "packages": [
    {
      "source": "npm:@scope/my-pi-package",
      "extensions": ["extensions/*.ts"],
      "skills": []
    }
  ]
}
```

---

## 12. Settings liên quan đến extension/package

Từ `docs/settings.md`, các settings quan trọng gồm:

- `packages`
- `extensions`
- `skills`
- `prompts`
- `themes`
- `enableSkillCommands`
- `npmCommand`

### Ví dụ settings project

```json
{
  "extensions": ["./extensions"],
  "packages": ["npm:@scope/my-pi-package"],
  "enableSkillCommands": true
}
```

### `npmCommand`

Đây là setting đáng chú ý khi package load qua npm trong các môi trường PATH lạ:

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

Từ code `pi-gui`, có thể thấy `npmCommand` rất hữu ích để runtime resolve npm packages ổn định trong GUI context.

---

## 13. Dependency model

Docs `packages.md` cho biết:

- dependencies bình thường để trong `dependencies`
- một số core packages của Pi nên để dưới dạng `peerDependencies` với `"*"`
- nếu package của bạn phụ thuộc vào package Pi khác, có thể cần `bundledDependencies`

### Các package core nên lưu ý

- `@mariozechner/pi-ai`
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-tui`
- `@sinclair/typebox`

---

## 14. Cấu trúc thư mục khuyến nghị

## 14.1 Extension đơn file

```text
.pi/
  extensions/
    hello.ts
```

Phù hợp khi:

- chỉ có 1 command/tool nhỏ
- đang prototype
- muốn iterate nhanh

## 14.2 Extension nhiều file

```text
.pi/
  extensions/
    my-extension/
      index.ts
      commands.ts
      tools.ts
      state.ts
      ui.ts
```

Phù hợp khi:

- extension có nhiều concerns
- cần tách state/UI/tools riêng
- muốn maintain lâu dài

## 14.3 Pi package chuẩn

```text
my-pi-package/
  package.json
  extensions/
    hello.ts
    review/
      index.ts
  skills/
  prompts/
  themes/
```

---

## 15. Ví dụ quickstart end-to-end

## 15.1 Tạo extension local theo project

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

## 15.2 Chạy Pi trong project

```bash
pi
```

## 15.3 Test command

```text
/hello
/hello Vu
```

## 15.4 Reload khi sửa

```text
/reload
```

---

## 16. Ví dụ starter template thực dụng

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

---

## 17. Những pattern extension đáng học từ examples local

## 17.1 `hello.ts`

Pattern:
- minimal custom tool
- thích hợp học syntax `registerTool`

## 17.2 `commands.ts`

Pattern:
- slash command introspection
- dùng `pi.getCommands()` để list commands đang available

## 17.3 `todo.ts`

Pattern:
- stateful tool
- persist state trong `details`
- rebuild state từ branch history
- rất phù hợp làm blueprint cho memory/state extension

## 17.4 `question.ts`

Pattern:
- advanced terminal UI bằng `ctx.ui.custom()`
- custom navigation/input/rendering
- tốt để hiểu terminal-native interactive workflow

---

## 18. Pi CLI vs host GUI: mức tương thích UI

Đây là phần không nằm trọn trong docs core, nhưng đọc `pi-gui` cho thêm insight quan trọng.

## 18.1 Những gì GUI host map được khá tốt

Từ `session-supervisor.ts` và test specs, host GUI có thể map các request kiểu:

- confirm
- select
- input
- editor
- notify
- status
- widget
- title
- editorText

Điều này nghĩa là nếu extension dùng các primitive này, xác suất chạy tốt trên host khác cao hơn.

## 18.2 `ctx.ui.custom()`

Từ test `extension-command-compatibility.spec.ts` và implementation `session-supervisor.ts`:

- host GUI không cố render arbitrary TUI
- thay vào đó nó ném ra unsupported-host-ui error cho `custom()`
- GUI coi loại command này là **terminal-only**

### Kết luận thiết kế

Nếu muốn extension:

- **chỉ cho terminal Pi CLI** → dùng `ctx.ui.custom()` ok
- **đa host / pi-gui / embedded app** → nên tránh phụ thuộc hoàn toàn vào `custom()`

## 18.3 Command visibility / native surfaces

Từ code `pi-gui` có thêm logic riêng để hiển thị một số extension settings như “native surfaces” trên trang Extensions. Tuy nhiên:

- đây là **host-specific adapter behavior**
- không thấy là API public chuẩn trong core docs extension hiện tại

=> Không nên coi đây là contract public của Pi CLI, trừ khi bạn đang build riêng cho host đó.

---

## 19. Security / Risk assessment

## 19.1 Quyền thực thi rất mạnh

Docs `extensions.md` và `packages.md` đều nhấn mạnh:

- extension chạy với full system access
- package bên thứ ba có thể thực thi code bất kỳ
- skills/extensions có thể khiến model chạy command nguy hiểm

### Hệ quả

Chỉ nên cài extension/package từ nguồn đáng tin.

## 19.2 Tool override risk

Extension có thể override built-in tools nếu đăng ký cùng tên.

Ví dụ:
- override `read`
- override `bash`
- override `write`

Điều này rất mạnh, nhưng cũng dễ gây:

- hành vi khác kỳ vọng
- security hole
- rendering/state mismatch nếu output shape không đúng

## 19.3 State drift risk

Nếu extension có state mà không gắn với session history, sẽ dễ bị lệch khi:

- branch
- fork
- navigate tree
- compact

Best practice: dùng `details` + reconstruct.

## 19.4 npm/package resolution risk

Từ `pi-gui` runtime code có thể thấy package resolution qua npm có thể fail trong môi trường GUI/PATH không chuẩn. Cần lưu ý `npmCommand` nếu deploy rộng.

---

## 20. Best practices đề xuất

### 20.1 Bắt đầu nhỏ

Làm lần lượt:

1. 1 slash command nhỏ
2. 1 tool nhỏ
3. 1 state pattern
4. 1 interactive flow

### 20.2 Tách concerns rõ ràng

Nếu extension lớn, nên tách:

- `commands.ts`
- `tools.ts`
- `hooks.ts`
- `state.ts`
- `ui.ts`

### 20.3 Ưu tiên primitives UI portable

Dùng trước:

- `confirm`
- `select`
- `input`
- `editor`
- `notify`
- `setEditorText`

Chỉ dùng `custom()` khi thật sự cần terminal-native UX.

### 20.4 State nên gắn với session history

Đặc biệt với:

- todo lists
- checkpoints
- memory nhỏ
- decisions theo branch

### 20.5 Nếu share package

- có `package.json` rõ ràng
- thêm `keywords: ["pi-package"]`
- tài liệu README rõ cách cài và gỡ
- hạn chế surprise behavior

---

## 21. Mẫu use cases phù hợp để build extension

Dựa trên docs/examples local, các loại extension rất phù hợp gồm:

1. **Safety guard**
   - confirm trước `bash`
   - chặn ghi `.env`
   - chặn thao tác destructive

2. **Workflow helpers**
   - `/handoff`
   - `/review`
   - `/draft`
   - `/preset`

3. **Stateful tools**
   - todos
   - checkpoints
   - task memory
   - issue tracker mini

4. **External integration**
   - HTTP API
   - CI hooks
   - webhook
   - remote tool bridges

5. **Model/runtime customization**
   - custom provider
   - tool mode switching
   - thinking level presets

6. **Rich terminal UX**
   - wizard
   - questionnaire
   - mini TUI workflow

---

## 22. Đề xuất cụ thể nếu mục tiêu là “pi harness extension”

Tên thư mục hiện tại là `pi-harness-extension`, nên nếu bạn muốn làm extension kiểu “harness” cho Pi, có thể đi theo một trong 3 hướng:

### Hướng A: Safety / execution harness

Mục tiêu:
- chặn tool calls nguy hiểm
- enforce policy
- log execution
- yêu cầu confirm trước action risk cao

Core APIs phù hợp:
- `pi.on("tool_call", ...)`
- `pi.on("tool_result", ...)`
- `ctx.ui.confirm(...)`

### Hướng B: Workflow harness

Mục tiêu:
- cung cấp commands/presets/toolchain cho team
- inject prompt conventions
- build slash commands cho workflow nội bộ

Core APIs phù hợp:
- `registerCommand`
- `before_agent_start`
- `input`
- `setActiveTools`

### Hướng C: Stateful memory harness

Mục tiêu:
- lưu session memory / task memory
- checkpoint/resume
- notes cho agent theo branch

Core APIs phù hợp:
- `registerTool`
- `appendEntry`
- rebuild state từ session branch

---

## 23. Gợi ý implementation roadmap

### Phase 1 — MVP

- tạo `.pi/extensions/my-extension.ts`
- thêm 1 command `/hello` hoặc `/draft`
- xác nhận `/reload` hoạt động

### Phase 2 — Tooling

- thêm 1 tool custom đơn giản
- test model có thể gọi tool
- log output và `details`

### Phase 3 — Guardrails

- chặn một số bash/write cases nguy hiểm
- thêm confirm UI

### Phase 4 — State

- persist state trong `details`
- reconstruct state trong `session_start/session_tree/session_fork`

### Phase 5 — Packaging

- tách package riêng
- thêm `package.json` với key `pi`
- install thử bằng `pi install ./local-path`

---

## 24. Checklist bắt đầu ngay

- [ ] Cài `pi` CLI
- [ ] Tạo `.pi/extensions/`
- [ ] Tạo `my-extension.ts`
- [ ] Export `default function (pi)`
- [ ] Thêm `registerCommand`
- [ ] Chạy `pi`
- [ ] Test slash command
- [ ] Dùng `/reload`
- [ ] Thêm `registerTool`
- [ ] Nếu có state, lưu trong `details`
- [ ] Nếu muốn share, package hóa qua `package.json`

---

## 25. Kết luận cuối

**Pi CLI có một extension system khá mạnh, thực dụng, và developer-friendly.**

Điểm mạnh chính:

- viết bằng TypeScript
- không cần fork runtime
- auto-discovery đơn giản
- mở rộng được cả command, tool, UI, lifecycle, provider, session
- có path rõ ràng để package hóa và share

Khuyến nghị thực tế:

- nếu mới bắt đầu, hãy làm **project-local extension** trong `.pi/extensions/`
- bắt đầu bằng **1 slash command nhỏ**
- sau đó thêm **1 custom tool**
- nếu extension có state, hãy lưu state theo **session history**, không theo global mutable state thuần
- nếu cần cross-host compatibility, hãy ưu tiên UI primitives thay vì `ctx.ui.custom()`

---

## 26. File output

Báo cáo chi tiết này được lưu tại:

- `REPORT_PI_EXTENSION_RESEARCH_DETAILED.md`

Báo cáo tóm tắt trước đó vẫn nằm tại:

- `REPORT_PI_EXTENSION_RESEARCH.md`


# PRD：工位显示器屏幕内容细节（让屏幕"演出"agent 的真实状态）

## 1. 背景与用户诉求

虚拟办公室场景中，小人在工位工作时电脑屏幕会"亮起来"，但目前亮起只是一整片纯色（`#a9d3e6` 淡蓝），没有任何内容细节。用户希望：

- 屏幕上不要只是一片白/纯色，要有**可辨认的趣味内容**；
- 举例：显示**终端命令行**、显示**正在浏览 GitHub 网站**等；
- 内容应随 agent 的真实状态变化（工作 / 等审核 / 摸鱼），让旁观者一眼读出"这个人在干什么"；
- **硬约束（用户原话）**："只是屏幕上的显示变化，核心上不应该破坏现有代码的流程的东西。"

### 已确认的取舍（来自上一轮实现被回滚的教训）

上一轮实现（深色终端主题 + 像素网格动画）功能上跑通了，但用户反馈"还是没好，没有达到预期效果"，要求回滚重做。**回滚前实际暴露的两个效果问题必须在新实现中避免**：

1. **远景可读性不足**：在默认相机距离（整个楼 3~4 层的视角）下，屏幕内容小到无法辨认，深色主题下工作屏看起来就是一块黑，观感反而不如原来的淡蓝亮屏。用户在这个视角下看效果的时间占绝大多数。
2. **遮挡类视觉 BUG 代价极高**：动画像素层与屏幕面板的 z 深度差只有 0.002m，一旦算错内容就被面板整个挡住（表现为"工作屏全黑、离岗屏反而亮"），且这种问题在代码审查中不易发现，必须靠真实渲染截图验证。

**建议新方向（供实现者参考，可推翻）**：与其"在屏幕上画小字"，不如用**大块面、高对比、有剪影感**的元素——例如整屏分成 2~4 个大色块（标题栏 + 内容区 + 侧栏），远看是"一块亮着的、有结构的屏幕"，近看才分辨内容；或让屏幕整体自发光颜色随状态变化（代码=冷蓝白、视频=暖橙闪烁、审核=紫调），再叠少量细节。验收标准应以**默认相机视角**的截图为准，而不是特写。

## 2. 现状技术事实（调查结论，可直接依赖）

- 渲染栈：**Three.js + React Three Fiber（R3F）**，体素/低多边形风格，**不是 canvas 像素画**。"像素感"来自小方块拼装，全项目无贴图管线（`public/` 只有字体），所有几何体程序化生成。
- 场景是**纯数据**：布局层（`frontend/src/scene/layout/`）把一切算成 `Part[]`（`{shape, position, scale, color, finish, rotation}`），组件只负责画。静态批量渲染按 `(shape, finish)` 分组成 InstancedMesh（`components/scene/parts/Batches.tsx`）。
- 屏幕本体：`frontend/src/scene/layout/models.ts` 的 `monitor()`（约 40~53 行）——一块 `0.59 × 0.34 × 0.005` 的 Box，`finish: "screen"`，颜色取 `PALETTE.screenOn`（亮）或 `PALETTE.screen`（灭），定义在 `frontend/src/scene/palette.ts:17-18`。
- `screen` finish 的材质是**不受光照的 `MeshBasicMaterial`**（`Batches.tsx:48`、`PartMeshes.tsx:36`），所以屏幕颜色就是最终呈现色。
- 亮灭逻辑：`assemble.ts:78` `workstation(agent !== undefined, agent?.atDesk ?? false)` → `monitor(..., on, ...)`。**只区分"在不在工位"**，`idle / working / waiting_review` 屏幕完全一样。
- 状态数据链路：后端 `/state` → `useWorldStore` → `Building.tsx` 的 `toFloorData()`（把 `presence(status,...)` 展开成 `AgentInput`）→ `buildScene()`。agent 真实状态语义已有现成来源：
  - `AgentStatus`（`lib/api.ts:3-10`）：`off_site / arriving / idle / working / waiting_review / leaving / returning`；
  - `current_task`：`stage`（plan/research/draft/self_check）、`waiting_for_model`、`on_web`、`web_step {kind, target}`；
  - `activity_log.at(-1).kind`（含 `waiting_model`）；
  - 铭牌文字已用这些语义（`lib/labels.ts` 的 `activityCaption`/`agentTag`），屏幕内容映射可对齐同一套判断。
- 逐帧动画基础设施：`frameloop="demand"` + `FrameDriver` 持续按 fps 供帧；`components/scene/motion/Motion.tsx` 在单个 `useFrame` 里从服务器时钟（`serverNow()`，含 `clockOffset`，多标签页一致）采样一切运动。现成的"逐帧改屏幕色"范例：门禁读卡器灯（`Motion.tsx:335-339`，直接改 `MeshBasicMaterial.color` / `.visible`）。
- InstancedMesh 逐实例改色：`mesh.setColorAt(i, color)` + `instanceColor.needsUpdate`（`Batches.tsx:82`）。注意材质/颜色缓存机制，屏幕内容若要"每块屏不同"，需要独立 mesh 或实例色，不能依赖共享材质。
- 同类屏幕（若改造范围要覆盖）：前台接待屏 `models.ts:139`、咖啡机小屏 `models.ts:177`、对话气泡 `moving.ts:184`。

## 3. 需求明细

### 3.1 状态 → 屏幕内容映射（核心功能）

| agent 状态（真实数据） | 屏幕应演出 | 必选/可选 |
|---|---|---|
| working（一般阶段） | 终端：命令行行块滚动 + 闪烁光标；或代码编辑器：行号槽 + 彩色代码条上滚 | 必选 |
| working 且 `on_web` / `web_step` | 浏览器窗口壳（红黄绿窗口点 + 地址栏），页面为 GitHub 风格：标题条 + commit 热力方块图逐列点亮 | 必选 |
| working 且 `waiting_for_model` | 加载动画（旋转圈 / 进度条循环） | 必选 |
| waiting_review | 聊天/评审：消息气泡块依次出现 + "正在输入…"三点跳动；或代码评审视图（一行高亮 + 红色批注点） | 必选 |
| idle（在岗空闲） | 摸鱼内容：**泛化的**视频网站（播放器壳 + 进度条走）、购物九宫格、小游戏（下落方块）等，按 agent 种子随机且稳定（刷新不变、多标签一致） | 必选 |
| 离岗（off_site / 行程中） | 熄灭态：保持现有淡出/暗屏语义，可加待机小灯等细节 | 可选 |

注：用户曾举例"浏览某成人网站"，双方同意改为**泛化视频站**（品牌剪影会意即可，不把具体站点烧进开源代码）。

### 3.2 双屏差异化
每个工位有 2 块屏（左 yaw +0.14 / 右 yaw −0.14，`models.ts` `workstation()`）。建议两块屏显示**不同**内容（如左终端右 GitHub），差异由 agent id / deskIndex 种子决定，同一 agent 稳定。

### 3.3 动画要求
- 用户明确选择**逐帧动画**（滚动、闪烁、进度推进），不是静态贴图式图案。
- 动画必须是**服务器时钟的纯函数**（同 Motion/office-life 的既有范式：`f(t)` 确定、可复现、多标签一致、无 React 逐帧渲染）。

### 3.4 附加细节（上轮方案中被用户勾选认可的，可继承）
- 屏幕光晕：工作时光投在桌面/键盘区一条冷色光带，摸鱼时暖色（静态 decal 即可）。
- 离岗休眠态：待机灯 + "合盖"横条之类的暗示细节。

## 4. 技术约束与已知陷阱（务必逐条规避）

1. **不破坏现有流程**：不改后端、不改 `/state` 结构、不改 Motion/office-life/trips 的行为；状态语义通过给 `AgentInput` **增加可选字段**（如 `activityKinds?`）传入，缺省值保证旧调用（如 `check-layout.mts` 的 fixture）不受影响。
2. **z 深度遮挡**：若在屏幕面板前方叠内容层，内容必须明确位于面板前面（面板半厚 0.0025，内容层建议 ≥0.004 余量），并**用真实渲染截图验证**，不能只看代码。
3. **`check:layout` 的 LED 断言**（`scripts/check-layout.mts:584-586`）：统计 `finish==="screen"` 且颜色为 `ledIdle(#3ddc84)/ledBusy(#ffb020)` 的零件数，busy 场景断言绿灯数为 0。**新增的屏幕元素不得使用这两个颜色值**（否则断言被打破，除非同步修改断言并说明理由）。
4. **帧率成本**：内容更新走 InstancedMesh 实例色或独立小 mesh，避免每帧 React 渲染；上轮实测全场景 ~1.7ms/帧（软件渲染），有充足余量。
5. **多标签一致性**：时间源用 `Motion.tsx` 的 `serverNow()`，种子用 id/deskIndex 的纯哈希（`palette.ts` 已有 `hashString`）。
6. **预览模式**：`?preview=1` 时 `presence()` 直接返回全员在岗（`presence.ts:22`），屏幕内容映射需要给 preview 一个合理的缺省（如上轮用 id 轮换 working 类视图），保证预览页每块屏都有内容。
7. **幽灵工位**（无人的空桌，`ghost`）保持现状半透明，不渲染屏幕内容。
8. **总监办公室工位**（`assemble.ts:151` 硬编码 `workstation(true, true)`）没有 agent 数据源，新实现要明确它的屏幕策略（亮但无内容 / 休眠），避免"无数据却显示某任务"的假象。

## 5. 验收标准（以截图为证据）

1. **默认相机视角**（打开页面不缩放）：能看出在岗 agent 的屏幕"亮着且有内容结构"，与空闲/离岗屏幕有肉眼可辨的差异；不允许出现"工作屏反而比离岗屏暗/黑"的观感倒挂。
2. **滚轮放大到任一工位**：能辨认出至少一种具体内容（终端行/浏览器壳/聊天气泡/视频播放器其一）。
3. 状态切换真实生效：agent 从 working → waiting_review → idle，屏幕内容随 `/state` 更新而变（可用 dev 库直接改 `agents.status` 验证，验证后还原）。
4. 动画在跑：间隔数秒的两帧截图中屏幕内容像素不同（滚动/闪烁）。
5. `npx tsc --noEmit` 零错误；`npm run check:layout` 全过（若调整断言需单独说明）；`npx eslint src` 零新增告警。
6. 现有功能回归：小人行程、办公室生活、铭牌、楼层显隐、相机聚焦/跟随均不受影响。

## 6. 验证方法（可复用的工具链）

上一轮已趟通的无头验证流程，新实现可直接沿用：

```bash
# 起服务（前端 3003、后端 8000，见 dev.sh）
./dev.sh -y --open

# 无头 Chrome + CDP：加载页面、执行 JS、滚轮缩放、截图
# /tmp/shot.mjs <url> <out.png> <js>          —— 导航+eval+截图
# /tmp/deskshot.mjs <url> <out.png> <x> <y> <wheelSteps> <dragPx> —— 滚轮放大（dollyToCursor）+可选拖拽旋转
# 页面坐标来源：window.__aiOffice.screenOf('agent:<id>')（DevProbe，dev-only）
```

注意：`__aiOffice.view(target, zoom)` 受相机 boundary/maxZoom 钳制，程序化定位特写不可靠；**用真实滚轮事件（dollyToCursor）+ 点击成员卡片聚焦（focusZoom 2.6×）组合**是有效路径。

## 7. 参考资料：上一轮实现（已回滚，可翻可不翻）

回滚前已备份，位于：
- `/tmp/screen-feature-tracked.patch`（10 个文件的 diff：presence 状态映射、models 静态外观、screens 像素纯函数、Screens 渲染层、palette、接线与 CLAUDE.md）
- `/tmp/screen-feature-screens.ts.bak`、`/tmp/screen-feature-Screens.tsx.bak`（两个新文件原件）

其中**架构接法**（`screenKindOf` 纯映射 → `AgentInput` 可选字段 → 独立 InstancedMesh 动画层，47 项布局校验全过、不碰 Motion）是被验证可行的；被否定的是**视觉方案**（12×8 小格 + 深底，远景不可读）。新实现可复用接法、重做视觉。

## 8. 边界（不做的事）

- 不引入贴图/纹理管线、不新增依赖；
- 不改后端与 API；
- 不在代码中出现具体成人/商业品牌内容（视频站、购物站均为无品牌剪影）；
- 不动办公室生活/行程动画的既有行为。

# 工时系统 — 页面风格指南

> 设计语言：Material Design 3 风格  
> 所有页面统一引用 `theme.css`，调整主题色、圆角、间距只需改这一个文件。

---

## 一、色彩体系

### 主色调

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--primary` | `#1b66c9` | 自有 / 主操作按钮 |
| `--on-primary` | `#ffffff` | 主色上的文字 |
| `--primary-c` | `#d7e7ff` | 主色容器（浅底按钮、徽章背景） |
| `--on-primary-c` | `#0a3b73` | 主色容器上的文字 |

### 外援辅色（青绿）

通过 `body.ext` 或 `body.ext-mode` 类整体切换：

| 令牌 | 值 |
|------|-----|
| `--ext` | `#006a6a` |
| `--on-ext` | `#ffffff` |
| `--ext-c` | `#9cf1ec` |
| `--on-ext-c` | `#003736` |

### 状态色

| 语义 | 背景 | 文字 |
|------|------|------|
| 成功 | `--green-c` `#bff0cd` | `--on-green-c` `#0a3d1d` |
| 警告 | `--amber-c` `#ffddb3` | `--on-amber-c` `#522300` |
| 错误 | `--red-c` `#ffdad6` | `--on-red-c` `#690005` |
| 信息 | `--info-c` `#d7e7ff` | `--info` `#1b66c9` |

### 中性 / 表面色

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--bg` | `#f7f9fc` | 页面背景 |
| `--surface` | `#ffffff` | 卡片背景 |
| `--surface-1` | `#f1f4f9` | 表头背景、hover 高亮 |
| `--surface-2` | `#e8edf4` | 进度条轨道 |
| `--on-surface` | `#1a1c1e` | 主要文字 |
| `--on-variant` | `#42474e` | 次要文字 |
| `--muted` | `#73777f` | 辅助说明文字 |
| `--faint` | `#a4a9b2` | 极淡文字 |
| `--outline` | `#c3c8d0` | 边框 |
| `--outline-soft` | `#e2e6ec` | 弱边框 |

---

## 二、形状与间距

### 圆角

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--r-xs` | `8px` | 输入框圆角 |
| `--r-sm` | `12px` | 卡片内元素 |
| `--r` | `16px` | 卡片圆角 |
| `--r-lg` | `24px` | 弹窗圆角 |
| `--r-pill` | `999px` | 胶囊按钮 / 徽章 |

### 间距阶梯

| 令牌 | 值 |
|------|-----|
| `--sp1` | `8px` |
| `--sp2` | `16px` |
| `--sp3` | `24px` |
| `--sp4` | `32px` |
| `--sp5` | `48px` |

### 阴影策略

- **卡片不用阴影** — 仅靠白色背景 + 细边框区分层级
- 仅弹出层使用 `--shadow-pop: 0 2px 10px rgba(0,0,0,.10)`

---

## 三、字体排印

### 字体栈

```css
font-family: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
```

等宽数据使用：

```css
font-family: "Roboto Mono", "Menlo", monospace;
```

### 字号层级

| 场景 | 字号 | 字重 |
|------|------|------|
| 页面标题 (h1) | 22px | 600 |
| 卡片标题 (h2) | 15px | 600 |
| 正文 | 14px | 400 |
| 表格内容 | 13px | 400 |
| 标签 / 说明 | 12.5px | 500 |
| 表头小字 | 11.5px | 600 |
| 辅助文字 | 11px | 400 |

---

## 四、组件规范

### 1. 按钮系统

| 类名 | 样式 | 用途 |
|------|------|------|
| `.filled` | 实心主色背景 + 白字 | 主操作 |
| `.tonal-btn` | 浅主色背景 + 深色字 | 次要操作 |
| `.outlined` | 透明背景 + 描边 + 主色字 | 边缘操作 |
| `.text-btn` | 透明背景 + 主色字（无框） | 最小化操作 |
| `.danger` | 红色浅底 + 深红字 | 危险操作 |
| `.btn-sm` | 高度 34px | 小号尺寸 |
| `.btn-xs` | 高度 28px | 超小号尺寸 |

**共同特征**：
- 全部 `border-radius: var(--r-pill)`（胶囊形）
- `transition: background .15s, opacity .15s`
- 禁用态 `opacity: .4; cursor: not-allowed`

### 2. 卡片系统

```html
<div class="card">
  <div class="card-head">
    <h2>标题</h2>
    <div class="toolbar">工具栏</div>
  </div>
  <!-- 内容区域 -->
</div>
```

- 背景：`var(--surface)`（白色）
- 边框：`1px solid var(--outline-soft)`
- 圆角：`var(--r)`（16px）
- 无阴影

可折叠卡片头部添加 `.collapsible` 类，配合 chevron 旋转动画。

### 3. 表格系统

```html
<div class="tbl-scroll">
  <table>
    <thead><tr>...</tr></thead>
    <tbody id="body"></tbody>
  </table>
</div>
```

- 表头：`background: var(--surface-1)`，`color: var(--muted)`，`font-size: 11.5px`，`letter-spacing: .04em`
- 固定表头：`position: sticky; top: 0; z-index: 1`
- 行 hover：`tr:hover td { background: var(--surface-1) }`
- 底部边框分隔：`td { border-bottom: 1px solid var(--outline-soft) }`
- 横向滚动：外层 `.tbl-scroll { overflow-x: auto }`

### 4. 徽章 (Badge)

```html
<span class="badge b-run">运行中</span>
<span class="badge chip-own">自有</span>
```

| 类型 | 类名 | 配色 |
|------|------|------|
| 运行中 | `.b-run` | 绿色系 |
| 已暂停 | `.b-pause` | 琥珀色系 |
| 已停止 | `.b-off` | 灰色系 |
| 需更新/过期 | `.b-exp` / `.b-red` | 红色系 |
| 自有类型 | `.chip-own` | 蓝色系 |
| 外援类型 | `.chip-ext` | 青绿色系 |

**共同特征**：`border-radius: var(--r-pill)`，`min-height: 24px`，`padding: 3px 12px`

### 5. 表单输入框

```html
<input type="text" placeholder="请输入...">
```

- 圆角：`var(--r-xs)`（8px）
- 聚焦态：`border-color: var(--primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 22%, transparent)`
- 禁用态：`background: var(--surface-1); color: var(--faint)`

### 6. 统计卡片 (Stats)

```html
<div class="stats">
  <div class="stat neutral/info/ok/warn">
    <div class="lbl">标签</div>
    <div class="val">数值</div>
  </div>
</div>
```

- Grid 布局，响应式列数（大屏 5 列 → 小屏 2 列）
- 不同语义用不同背景色

### 7. 进度条

```html
<div class="prog-bar"><div class="prog-fill" style="width: 60%"></div></div>
```

- 轨道高度：6px，圆角 `var(--r-pill)`
- 填充色：`var(--primary)`
- 平滑过渡：`transition: width .3s ease`

### 8. 模态弹窗

```html
<div class="overlay show">
  <div class="dialog">
    <h2>标题</h2>
    <div class="body">内容</div>
    <div class="foot">操作按钮</div>
  </div>
</div>
```

- 遮罩：`rgba(0,0,0,.4)`，`position: fixed; inset: 0`
- 弹窗：`max-width: 520px`，`border-radius: var(--r-lg)`，`box-shadow: var(--shadow-pop)`
- 点击遮罩外部关闭

### 9. 开关控件 (Toggle Switch)

```html
<label class="switch">
  <input type="checkbox">
  <span class="track"></span>
  <span class="sw-label">文字</span>
</label>
```

- 轨道宽度 40px，高度 24px，圆角 999px
- 滑块 18px 圆形，滑动动画 `translateX(16px)`
- 选中态背景切换为 `var(--primary)`

---

## 五、布局模式

### 标准页面骨架

```html
<div class="wrap">
  <!-- 顶部栏 -->
  <div class="appbar">...</div>
  <!-- 或 <div class="page-header">...</div> -->

  <!-- 卡片内容 -->
  <div class="card">...</div>
  <div class="card">...</div>
</div>
```

### 关键 CSS

```css
.wrap {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--sp3) var(--sp2) var(--sp5);
}

.appbar {
  display: flex;
  align-items: center;
  gap: var(--sp2);
  flex-wrap: wrap;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--sp3);
  gap: var(--sp2);
  flex-wrap: wrap;
}

.toolbar {
  display: flex;
  gap: var(--sp1);
  align-items: center;
  flex-wrap: wrap;
}

.stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--sp2);
}
@media (max-width: 900px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
}
```

---

## 六、交互细节

| 特性 | 实现方式 |
|------|----------|
| **过渡动画** | `transition: background .15s, opacity .15s`（快速响应） |
| **进度条平滑** | `transition: width .3s ease` |
| **折叠面板** | `.collapsed { display: none }` + chevron `transform: rotate(90deg)` |
| **图表 Tooltip** | `position: fixed`，跟随鼠标，pointer-events: none |
| **行展开/收起** | 相邻 `<tr>` 控制 `display: none/block` |
| **自动刷新** | `setInterval` + `document.hidden` 检测 |
| **Hover 效果** | `color-mix(in srgb, var(--primary) 8%, transparent)` 微变亮 |

---

## 七、生成类似页面的检查清单

- [ ] 引用 `theme.css` 获取全局设计令牌
- [ ] 使用 CSS 变量，不写死颜色值
- [ ] 布局使用 `.wrap > .appbar > .card` 结构
- [ ] 卡片 = 白底 + `1px solid var(--outline-soft)` + `16px` 圆角 + 无阴影
- [ ] 按钮全部 `border-radius: 999px`（胶囊形）
- [ ] 表格使用 sticky 表头 + hover 行高亮 + 横向滚动容器
- [ ] 徽章使用 `.badge` + 语义化类名
- [ ] 输入框 focus 时显示 primary 色光晕
- [ ] 过渡统一 `.15s`
- [ ] 响应式使用 `@media` 断点和 `flex-wrap`

---

*最后更新：2025年*

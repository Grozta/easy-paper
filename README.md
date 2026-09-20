# Paper Manager

> 一个用于 [Obsidian](https://obsidian.md) 的论文管理插件：通过 DOI 自动抓取论文元数据、下载开放获取 PDF、管理论文笔记。
>
> 一个拥有和Zotero论文管理方式比肩的优秀视图。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7c3aed)](https://obsidian.md)

---
## 预览
<img width="2880" height="1698" alt="image" src="https://github.com/user-attachments/assets/b3fdb458-b918-4185-b531-0d72859d4ae3" />

---
## ✨ 功能

### 📥 论文元数据自动抓取

- **DOI 一键创建笔记**：输入 DOI，自动从 [OpenAlex](https://openalex.org/) 获取标题、作者、年份、期刊、出版社、论文类型、引用数、摘要、ISSN 等元数据
- **arXiv 支持**：识别 `10.48550/arXiv.xxxx.xxxxx` 格式的 DOI，通过 arXiv API 获取 preprint 元数据（含完整摘要）
- **期刊指标查询**：集成 [EasyScholar](https://www.easyscholar.cc/) 查询影响因子、JCR 分区、中科院分区
- **会议名缩写**：自动从期刊名中提取或匹配会议缩写（CVPR、ICCV、NeurIPS 等）

### 📄 PDF 自动下载

- 集成 [Unpaywall](https://unpaywall.org/) 获取开放获取 PDF 直链
- 支持 arXiv、PLOS ONE 等出版商的直链构造
- 多层校验（HTTP 状态码 / 空响应 / PDF 文件头），避免产生垃圾文件
- 已存在且有效的 PDF 自动跳过

### 📊 双视图展示（基于 Bases）

- **树形视图**：按文件夹层级浏览论文，徽章显示年份、期刊、引用数、IF、分区
- **表格视图**：资源管理器式导航，跟随左侧文件树（单击展开 / 双击进入）

**表格视图可配置项**：

- 列显示 / 隐藏（名称列固定）
- 排序字段 + 方向（默认创建时间倒序）
- 数值列颜色规则（引用数、IF 按阈值着色）
- 枚举列颜色映射（JCR、中科院分区）
- 拖拽调整列宽并持久化
- 中科院分区两行居中显示，只对 `X区` 部分着色
- 返回上级目录按钮

### 🔄 元数据刷新

- **单篇刷新**：在笔记右键菜单或命令面板触发
- **批量刷新**：设置面板一键刷新所有论文
- **DOI 变更检测**：对比插件私有记录与笔记当前 DOI，仅在变更时刷新
- **来源追溯**：DOI 从 arXiv 变更为正式发表版本时，自动记录 `previous_doi`

---

## 📦 安装

### 从 Obsidian 社区插件安装（待上架）

1. 打开 Obsidian 设置 → **第三方插件**
2. 点击 **浏览**，搜索 `Paper Manager`
3. 安装并启用

### 手动安装

1. 从 [Releases](https://github.com/你的用户名/paper-manager/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 在库的 `.obsidian/plugins/` 下新建文件夹 `paper-manager`
3. 把三个文件放入该文件夹
4. 重启 Obsidian，在 **设置 → 第三方插件** 中启用

---

## 🚀 快速上手

### 1. 创建你的第一篇论文笔记

- 点击左侧功能区的 **📄 从 DOI 创建论文笔记** 图标
- 输入 DOI，例如：
  - 期刊论文：`10.1038/nature12373`
  - arXiv 论文：`10.48550/arXiv.1706.03762`
- 选择存放位置（支持文件夹自动补全）
- 点击 **创建笔记**

插件会自动：

- 在指定目录创建 Markdown 笔记
- 写入完整的 Frontmatter 元数据
- 将摘要填入正文的 `## 摘要` 区块
- 尝试下载开放获取 PDF 到指定目录
- 自动添加 `paper` 标签

### 2. 浏览所有论文

插件会在库根目录自动创建 `paper-manager.base` 文件，用 Obsidian 打开它就能看到：

- **按文件夹**：树形视图
- **全部论文**：表格视图

### 3. 更新元数据

- **单篇**：在文件浏览器中右键论文笔记 → **重新检索 DOI**
- **批量**：设置 → Paper Manager → 批量操作 → **立即刷新**

### 4. **注意**
- 也可以不从DOI导入创建笔记，只要是根目录下的笔记文件，笔记属性中包含`tags：paper`即可接受视图管理。如自己创建的xx.md文件中包含`tags：paper`，它隶属于插件设置中的根目录，就可以在视图中显示信息。

---

## ⚙️ 配置

插件设置分为以下几个区块：

### 目录设置

| 选项           | 说明                                                         |
| :------------- | :----------------------------------------------------------- |
| **论文根目录** | 论文笔记的根目录。创建笔记时默认放于此目录下；表格视图只在此目录内联动 |
| **PDF 文件夹** | 存放论文 PDF 的目录。创建笔记时不可选此目录；表格视图会跳过  |

### 论文标识

| 选项               | 说明                                     |
| :----------------- | :--------------------------------------- |
| **论文标识符**     | 创建笔记时自动添加的标签（默认 `paper`） |
| **应用到现有笔记** | 为论文目录下所有 Markdown 文件补打标签   |

### 表格视图

- 列显示开关
- 排序字段和方向
- 引用数 / 影响因子颜色阈值规则
- JCR / 中科院分区颜色映射

### 外部 API

| 选项                       | 说明                                                      | 必需             |
| :------------------------- | :-------------------------------------------------------- | :--------------- |
| **Unpaywall 邮箱**         | 任意合法邮箱，Unpaywall 用于标识调用方                    | 是               |
| **EasyScholar Secret Key** | 在 [easyscholar.cc](https://www.easyscholar.cc/) 注册获取 | 用于期刊指标查询 |

### 批量操作

- **刷新所有论文元数据**：仅刷新 DOI 发生变化的笔记

---

## 📋 笔记字段说明

插件会在笔记 Frontmatter 中写入以下字段：

| 字段            | 来源                 | 说明                                           |
| :-------------- | :------------------- | :--------------------------------------------- |
| `doi`           | 输入                 | 论文 DOI                                       |
| `arxiv_id`      | arXiv API            | arXiv ID（若适用）                             |
| `previous_doi`  | 自动追踪             | DOI 变更前的旧 DOI（如 arXiv 版 → 正式版）     |
| `title`         | OpenAlex / arXiv     | 论文标题                                       |
| `authors`       | OpenAlex / arXiv     | 作者列表                                       |
| `year`          | OpenAlex / arXiv     | 出版年份                                       |
| `journal`       | OpenAlex             | 期刊 / 会议全称                                |
| `venue_short`   | 自动提取             | 会议缩写（如 CVPR、NeurIPS）                   |
| `issn`          | OpenAlex             | 期刊 ISSN                                      |
| `publisher`     | OpenAlex             | 出版商                                         |
| `type`          | OpenAlex             | 论文类型（article / conference / preprint 等） |
| `cited_by`      | OpenAlex             | 引用数                                         |
| `impact_factor` | EasyScholar          | 影响因子                                       |
| `sci_quartile`  | EasyScholar          | JCR 分区（Q1-Q4）                              |
| `cas_quartile`  | EasyScholar          | 中科院分区（如 `医学2区`）                     |
| `oa_url`        | OpenAlex             | 开放获取落地页                                 |
| `pdf_url`       | OpenAlex / Unpaywall | PDF 直链                                       |
| `pdf`           | 插件生成             | 本地 PDF 链接 `[[path]]`                       |
| `abstract`      | OpenAlex / arXiv     | 摘要                                           |
| `tags`          | 插件生成             | 包含 `paper` 标签                              |

---

## ❓ 常见问题

### PDF 下载失败怎么办？

**现象**：笔记创建后提示"无法自动下载 PDF"。

**原因**：论文不是开放获取（如 Nature、Science 的订阅文章），或出版商限制自动下载。

**处理**：手动从出版商网页下载 PDF 到插件设置的 PDF 目录，文件名与笔记同名。

### 期刊指标为空白？

**原因**：未配置 EasyScholar Secret Key，或该期刊不在 EasyScholar 数据库中。

**处理**：在设置中填入 Secret Key。arXiv preprint 通常没有期刊指标，这是正常的。

### 表格视图没有显示我的论文？

**检查**：

1. 笔记是否在论文根目录下
2. 笔记是否有 `paper` 标签（可在设置里批量添加）
3. 视图切换菜单是否选择了正确的视图

### DOI 刷新后元数据没变？

**原因**：插件检测到笔记当前 DOI 与上次生成元数据时的 DOI 一致，跳过刷新。

**处理**：如果你想强制刷新，可以手动修改 `doi` 字段（哪怕加个空格），再点刷新。

### 我的 `data.json` 会上传到 Git 吗？

不会。`data.json` 保存在 `.obsidian/plugins/paper-manager/data.json`，包含你的 API 密钥和本地路径，插件源码的 `.gitignore` 已排除。**永远不要**把它分享给他人。

---

## 🛠️ 开发

### 环境要求

- Node.js 18+
- Obsidian 1.4.0+

### 构建

```bash
# 安装依赖
npm install

# 开发模式（watch）
npm run dev

# 生产构建
npm run build
```

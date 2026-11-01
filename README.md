# ResumeLens · 简历透视

AI 简历体检 + 面试官模拟筛选 + 一键生成优化版简历。

- **体检报告**：岗位匹配分、五维拆解、致命硬伤与亮点
- **面试官模拟筛**：8 秒初筛推演，通过率前后对比、面试官原话、修复清单
- **优化版简历**：STAR 量化重写、关键词对齐 JD，支持复制 / 下载 .md / 导出 PDF

纯浏览器运行（无需后端），简历内容只在你本机解析，不经过任何服务器。

> PDF / Word 解析库（pdf.js、mammoth）已内置在 `vendor/` 目录，**不依赖任何公网 CDN**——离线、直开 `file://`、GitHub Pages 环境下都能正常解析。

## 使用

1. 打开网站（GitHub Pages 或本地直接打开 `index.html`）
2. 点击右上角 **设置 API Key**，选择服务商并填入密钥（仅保存在你自己的浏览器 localStorage）
3. 上传简历（PDF / Word / TXT）或粘贴文本 + 粘贴岗位 JD → 开始分析

> 未配置 Key 时为**本地规则预览**：基于你上传的真实简历与 JD 做关键词匹配、量化与结构分析（非 AI，不编造内容），结果页会明确提示；配置 Key 后即升级为 AI 深度分析与全文重写。

## API Key 获取（二选一）

| 服务商 | 步骤 | 默认模型 |
|---|---|---|
| 通义千问 Qwen（推荐） | 阿里云控制台 → 开通「百炼大模型」→ API-KEY 管理 → 创建 Key | `qwen-plus` |
| DeepSeek | platform.deepseek.com → API Keys → 创建 | `deepseek-chat` |

也支持任意 OpenAI 兼容接口（Kimi / 智谱 / Ollama 等），在设置里选「自定义」。

## 本地运行

直接双击 `index.html` 即可；或起一个静态服务：

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

## 部署到 GitHub Pages

推送本目录全部文件到仓库根目录，然后在仓库 Settings → Pages → 选择 `main` 分支 `/ (root)` 即可。

## 安全说明

- API Key 只存在浏览器 localStorage，**不写入代码库、不上传服务器**
- 简历与 JD 只在浏览器内解析后直接发送给你自己配置的模型接口
- 请勿在公共电脑上保存密钥


<h1 align="center">
AcadHomepage
</h1>

<div align="center">

[![](https://img.shields.io/github/stars/RayeRen/acad-homepage.github.io)](https://github.com/RayeRen/acad-homepage.github.io)
[![](https://img.shields.io/github/forks/RayeRen/acad-homepage.github.io)](https://github.com/RayeRen/acad-homepage.github.io)
[![](https://img.shields.io/github/issues/RayeRen/acad-homepage.github.io)](https://github.com/RayeRen/acad-homepage.github.io)
[![](https://img.shields.io/github/license/RayeRen/acad-homepage.github.io)](https://github.com/RayeRen/acad-homepage.github.io/blob/main/LICENSE)  | [English README](../README.md) 

</div>

<p align="center">一个现代、响应式的个人学术主页</p>


<p align="center">
    <br>
    <img src="./screenshot.png" width="100%"/>
    <br>
</p>

一些例子：
- [样例页面](https://rayeren.github.io/acad-homepage.github.io/)
- [作者的个人主页](https://rayeren.github.io/)

## 主要特点
- **自动更新论文与引用**: GitHub Actions 每日分别同步 Google Scholar 和知网，中文、英文论文使用同一套列表样式；引用数保留来源标识。
- **支持谷歌Analytics**: 你可以通过简单的配置来实现使用谷歌Analytics跟踪网页的流量。
- **响应式的**: 此主页会针对不同的屏幕尺寸自动调整布局。
- **美观而简约**: 此主页美观而简约，适合个人学术主页的搭建。
- **搜索引擎优化**: 搜索引擎优化 (SEO) 帮助搜索引擎轻松找到您在主页上发布的信息，然后将其与类似网站进行排名，并获得排名优势。

## 快速开始

1. Fork本仓库到`USERNAME/USERNAME.github.io`，其中`USERNAME`是你的github用户名。
1. 配置论文同步（详见下方“论文与引用自动更新”）：
    1. 当前默认 Google Scholar ID 为 `lJydfDEAAAAJ`，知网作者 ID 为 `000077413616`，对应[知网个人主页](https://au.cnki.net/author/workbench/personalHomePage/000077413616)。
    1. 如需修改作者，在仓库的 `Settings -> Secrets and variables -> Actions -> Variables` 添加 `GOOGLE_SCHOLAR_ID`、`CNKI_AUTHOR_ID` 两个 Repository variables；填写作者 ID，无需 Cookie 或密码。
    1. 在仓库 `Actions` 中启用 `Update academic publications` 工作流，并通过 `Run workflow` 执行首次同步。
1. 使用 [favicon-generator](https://redketchup.io/favicon-generator)生成favicon（网页icon文件），并下载所有文件到`REPO/images`。
1. 修改主页配置文件[_config.yml](../_config.yml):
    1. `title`: 主页标题
    1. `description`: 主页的描述
    1. `repository`: USER_NAME/REPO_NAME  
    1. `google_analytics_id` (可选的): 谷歌Analytics ID
    1. SEO相关的键值 (可选的): 从搜索引擎的控制台里获得对应的ID (例如：Google, Bing and Baidu)，然后粘贴到这里。
    1. `author`: 主页作者信息，包括其他网页、Email、所在城市、大学等。
    1. `google_scholar_stats_use_cdn`: 使用CDN读取存储于`https://raw.githubusercontent.com/`的google scholar引用统计数据，防止中国大陆地区被墙无法访问的情况。但是CDN有缓存，因此`google_scholar_stats_use_cdn : True`时，引用数据更新会有延迟。
    1. 更多的配置信息在注释中有详细描述。
1. 将你的主页内容添加到 [_pages/about.md](../_pages/about.md).
1. 你的主页将会被部署到`https://USERNAME.github.io`.

## 论文与引用自动更新

工作流文件是 [update_google_scholar_stats.yml](../.github/workflows/update_google_scholar_stats.yml)，文件名保留以便兼容原有配置。它每天在北京时间 16:00（08:00 UTC）计划运行，也可在 `Actions -> Update academic publications -> Run workflow` 手动运行。修改该工作流或两个爬虫目录中的代码并推送到 `main` 时也会触发同步。[GitHub 的定时任务规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)说明，任务可能延迟；公开仓库连续 60 天没有仓库活动时，定时工作流可能被自动停用，需要在 Actions 页面重新启用。

首次使用时，将这次修改推送到 `main`，确认仓库允许 Actions 运行及工作流写入内容。运行结束后，检查三个任务：`Fetch Google Scholar`、`Fetch CNKI` 和 `Publish successful datasets`。成功获取的数据保存在 `google-scholar-stats` 分支，主页优先加载该分支中的 JSON 数据。若使用 `_config.yml` 的 `google_scholar_stats_use_cdn` 选项，CDN 缓存可能使页面稍后才显示最新数据。

| 数据文件 | 内容 |
| --- | --- |
| `gs_data.json` | Google Scholar 论文、作者引用总数与相关指标 |
| `gs_data_shieldsio.json` | 兼容现有 Google Scholar 引用徽章 |
| `cnki_data.json` | 知网论文、可公开获取的引用数据与同步时间 |

截至 2026 年 10 月 20 日，已通过知网公开作者页使用的 HTTPS 接口取得该作者的 12 项公开成果：11 篇期刊论文和 1 篇硕士学位论文。知网作者引用总数包含学位论文，应按知网作者页的成果统计口径理解。此次数量是一次已核验的快照，并非固定值。

仓库还保存了 [assets/data/cnki_data.json](../assets/data/cnki_data.json) 作为初始知网快照。当数据分支中的知网 JSON 尚未生成或无法读取时，页面会尝试加载这份随网站发布的文件，并显示 `Saved snapshot` 及其同步日期。快照不会因浏览页面而自动更新；后续优先使用 Actions 发布的数据。若两个来源及知网快照都无法加载，页面显示手动维护的备用论文列表；任一来源已有可展示数据时，使用同步列表。

中文论文与英文论文共用主页中的论文卡片样式。可识别为同一篇的论文合并展示，并保留各自来源链接；没有足够匹配信息时保留独立记录。中英文题名对应关系记录在 [cnki_crawler/publication_aliases.json](../cnki_crawler/publication_aliases.json)，属于人工核对的显式映射，不会自动翻译、猜测匹配；后续需要合并其他中英文题名时，应先核对对应论文再添加映射。**Google Scholar 与知网引用数分别标注，不相加**：两个数据库的覆盖范围、更新时间和施引文献可能重叠，公开作者页面无法提供足以核对全部重叠项的数据。知网未提供的指标显示为不可用，而不是当作 0。

两个来源独立执行。任何一个来源失败，另一个成功来源仍会发布；失败来源的上次成功 JSON 会继续保留。两者都失败时不修改数据分支。工作流会保留失败状态，方便在 Actions 日志中排查，不会把失败响应或空列表覆盖到有效数据上。页面显示每个来源的最近成功同步日期，以便判断数据时效。

知网同步范围是该公开作者主页中已关联或已认领、且公开可见的成果。新论文仅在被关联到该作者主页、允许公开展示且一次同步成功后才会出现在个人主页；仅被知网全库收录但尚未关联到该作者的论文，不在此次同步范围内。

同步依赖公开页面及公开接口的实际可访问情况。此次抓取无需 Cookie、登录账号或密码，使用正常 HTTPS 连接并保留 TLS 证书校验。知网或 Google Scholar 可能返回验证码、登录要求、访问限制、超时，或调整页面结构；此时无法保证当日获取新论文。爬虫不会绕过这些限制。可先检查对应来源的 Actions 日志，确认公开页面恢复访问后再手动重试。

知网爬虫默认忽略系统代理环境变量，直接连接公开 HTTPS 接口。如果本地网络必须使用环境代理，可在运行爬虫前设置 `CNKI_USE_ENV_PROXY=1`。例如在 PowerShell 中：

```powershell
$env:CNKI_USE_ENV_PROXY = "1"
Set-Location cnki_crawler
python main.py
```

这项设置只影响当前命令行环境；现有 Actions 工作流没有传入该变量。若运行 Actions 的网络环境确实需要环境代理，应在工作流的知网抓取步骤显式配置相应环境变量。不要通过关闭 TLS 校验解决证书错误。

## 本地调试

1. 使用`git clone`将本项目克隆到本地。
1. 安装Jekyll的构建环境，包括`Ruby`、`RubyGems`、`GCC`和`Make`。可参考[该教程](https://jekyllrb.com/docs/installation/#requirements)。
1. 运行 `bash run_server.sh` 来启动Jekyll实时重载服务器。
1. 在浏览器里打开 [http://127.0.0.1:4000](http://127.0.0.1:4000)。如果你修改了网页的源码，服务器会自动重新编译并刷新页面。
1. 当你修改完毕你的页面以后, 使用`git`命令，`commit`你的改动并`push`到你的github仓库中。

# Acknowledges

- AcadHomepage incorporates Font Awesome, which is distributed under the terms of the SIL OFL 1.1 and MIT License.
- AcadHomepage is influenced by the github repo [mmistakes/minimal-mistakes](https://github.com/mmistakes/minimal-mistakes), which is distributed under the MIT License.
- AcadHomepage is influenced by the github repo [academicpages/academicpages.github.io](https://github.com/academicpages/academicpages.github.io), which is distributed under the MIT License.

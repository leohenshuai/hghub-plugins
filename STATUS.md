# 片源状态

更新于 2026-11-21 03:33 UTC · 共 28 个源 · 🔴 6 不可用 · 🟡 5 有小问题 · 🟢 17 正常

> 由 GitHub Actions 每天自动体检：分类（抽样）→ 首页 → 搜索 → 详情 → 实际请求视频流，
> 另在 QuickJS 里测「最长连续同步执行」（App 超过 1 秒会强行中断插件）。
> 服务器在境外机房，个别站点可能因地区限制或风控误报，以手机实测为准。

| | 源 | 版本 | 分类 | 首页 | 视频流 | 同步段 | 问题 |
|---|---|---|---|---|---|---|---|
| 🔴 | avtoday `avtoday` | 1.0.3 | 15 | 27 | 206 video/mp4 | **卡死** | 搜索无结果/失败 UNAVAILABLE 站点搜索被 Cloudflare 人机验证拦截，暂不可用；请从分类浏览 |
| 🔴 | 多播 duobo `duobo` | 1.0.3 | 64 | 60 | 206 binary/octet-stream | **卡死** |  |
| 🔴 | 海角 `haijiao` | 1.0.0 | 10 | 34 | - | 2ms | 播放解析失败 AUTH_REQUIRED 海角播放需要登录：到插件设置里填写登录令牌（X-User-Token，可选用户 ID） |
| 🔴 | Hanime1 `hanime` | 1.0.4 | 0 | - | - | 1ms | 分类列表失败 UPSTREAM_ERROR 页面暂时不可用（HTTP 403）；首页失败 UPSTREAM_ERROR 页面暂时不可用（HTTP 403）；搜索无结果/失败 UPSTREAM_ERROR 页面暂时不可用（HTTP 403） 等 4 项 |
| 🔴 | 玩偶姐姐 `hkdoll` | 1.0.3 | 34 | 180 | 000 [m3u8] | 6ms | 视频流不可用 000 [m3u8] |
| 🔴 | 金牌影视 `jpyy` | 1.0.1 | 4 | 30 | 206 application/vnd.appl | **卡死** |  |
| 🟡 | AVJB `avjb` | 1.0.0 | 80 | 23 | 200 application/vnd.appl | 6ms | 搜索无结果/失败 「jav」0 条 |
| 🟡 | Rou Video `rou` | 1.0.0 | 23 | 96 | 206 image/png | 5ms | 分类 无码素人: NOT_FOUND 页面不存在；分类 日韩中字: NOT_FOUND 页面不存在；分类 3D动漫: NOT_FOUND 页面不存在 等 8 项 |
| 🟡 | 糖心Vlog `tangxin` | 1.0.0 | 276 | 24 | 206 audio/x-mpegurl [m3u | 3ms | 搜索无结果/失败 「jav」0 条 |
| 🟡 | 农民影视 `wwgz` | 1.0.2 | 5 | 30 | 206 application/vnd.appl | 7ms | 搜索无结果/失败 UNAVAILABLE 站点搜索功能已损坏（服务端缺少模板），请从分类浏览 |
| 🟡 | xHamster `xhamster` | 1.0.2 | 3 | 0 | - | 1ms | 分类 最新: 空；分类 本周最佳: 空；分类 4K: 空 等 6 项 |
| 🟢 | 4k-av `4kav` | 1.0.3 | 3 | 48 | 206 application/x-mpegUR | 1ms |  |
| 🟢 | 91porn `91porn` | 1.0.1 | 12 | 48 | 206 video/mp4 | 2ms |  |
| 🟢 | 小苹果 `apple` | 1.0.1 | 4 | 20 | 206 application/vnd.appl | 1ms |  |
| 🟢 | 911爆料网 `bl911` | 1.0.1 | 25 | 110 | 206 text/plain; charset= | 2ms |  |
| 🟢 | 好色TV `haose` | 1.0.1 | 31 | 57 | 200 text/plain; charset= | 2ms |  |
| 🟢 | hdmoli `hdmoli` | 2.0.0 | 3 | 20 | page:https://pan.baidu.c | 1ms |  |
| 🟢 | 黄果短剧 `huangguo` | 1.0.3 | 6 | 86 | 200 text/plain; charset= | 3ms |  |
| 🟢 | 18J.TV `j18` | 1.0.0 | 36 | 60 | 200 application/vnd.appl | 3ms |  |
| 🟢 | 麻豆社 `madou` | 1.0.3 | 32 | 20 | 206 application/vnd.appl | 2ms |  |
| 🟢 | 每日大赛 `mrds` | 1.0.1 | 15 | 27 | 200 text/plain; charset= | 10ms |  |
| 🟢 | KKAV `mwxk62` | 1.0.3 | 23 | 114 | 206 application/octet-st | 49ms |  |
| 🟢 | 91Porna `porna91` | 1.0.1 | 12 | 80 | 200 text/plain; charset= | 9ms |  |
| 🟢 | Pornhub `pornhub` | 1.0.2 | 5 | 34 | 206 application/vnd.appl | 9ms |  |
| 🟢 | 撸撸视频 Pornlulu `pornlulu` | 1.0.1 | 66 | 72 | 206 application/vnd.appl | 2ms |  |
| 🟢 | 91Porny（九色） `porny` | 1.0.0 | 14 | 39 | 206 application/vnd.appl | 2ms |  |
| 🟢 | 星芽短剧 `xingya` | 1.0.3 | 5 | 24 | 206 video/mp4 | 1ms |  |
| 🟢 | 主播视频 `xx9` | 1.0.2 | 23 | 146 | 200 [m3u8] | 2ms |  |

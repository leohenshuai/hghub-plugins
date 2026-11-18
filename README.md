# HGhub 修复版片源

订阅地址：`https://raw.githubusercontent.com/leohenshuai/hghub-plugins/main/manifest.json`

| 源 | 版本 | 修复内容 |
| --- | --- | --- |
| 4k-av | 1.0.2 | 4kmp.com → 4k-av.com；补 Accept-Language（WAF 无此头返回 403） |
| Hanime1 | 1.0.3 | 主域被 Cloudflare 拦截 → 镜像 hanimeone.me；分类页新卡片结构 `.video-item-container`；中文分类链接编码（原先 400）；过滤广告外链 |
| 星芽短剧 | 1.0.2 | 接口偶发 9–12s 慢响应：超时 15s→25s，重试 1→2 |
| 麻豆 | 1.0.2 | 隐藏站点已为空的「7天/30天热门」 |
| 玩偶姐姐 | 1.0.2 | 中文/空格分类路径编码（原先请求失败）；过滤站外广告分类；隐藏站点为空的系列 |
| AVToday | 1.0.2 | 过滤站外广告分类（Telegram 链接） |

原作：https://github.com/CoderL98/hghub-plugins

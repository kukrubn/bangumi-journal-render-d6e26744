# 番剧手账

为一个人、一份片单设计的追番 PWA。电脑上整理收藏，手机上点 `+1`、记书签，两端登录同一个站点，刷新就能看到同一份进度。应用使用 Next.js、TypeScript 和 PostgreSQL，附带 Render 与 Neon 的部署配置。

## 可以做什么

- 用番名、Bangumi 条目 ID 或链接导入，也可以按 Bangumi 用户名批量同步公开收藏。手动录入适合 OVA、自建条目和临时修订的集数。
- 按在看、想看、已看、搁置和抛弃整理片单。想看的番剧点 `+1` 即转为在看，到最后一集可确认完结并评分。
- 记录短评和精确到秒的分集书签，保存播放链接，按个人标签、年份、类型和观看状态组合筛选。连载周表高亮今日更新，欠番优先按本篇章节的放送日期统计，周更推算会标出“预计”。
- 看板汇总观看集数、估算时长、类型和评分。JSON 可完整备份、预览冲突并恢复。CSV 单向导出，适合表格查看。

## 在 Windows 本机运行

安装 Node.js 24 和 PostgreSQL 18（含 `initdb`、`pg_ctl`、`psql`）。下载或克隆源码，在项目根目录打开 PowerShell，执行以下命令，将示例邮箱换成自己的登录邮箱。

```powershell
npm.cmd ci
npm.cmd run account:setup -- me@example.com
npm.cmd run dev
```

按提示设置至少 8 个字符的密码。初始化脚本写入本机 `.env.local` 和 `.journal-local/`，首次启动会下载 PostgREST 并初始化独立的本机数据库。在浏览器打开 [本机片单](http://localhost:3000)，用刚设置的邮箱和密码登录。用完后按 `Ctrl+C` 停止网页服务，运行 `npm.cmd run db:stop` 停止本机数据库服务。

## 部署到 Render 和 Neon

1. 先完成一次本机启动，创建自己的开发者账号。这个邮箱和密码就是应用登录凭据，每个部署只绑定一个片单所有者。
2. 在自己的 Neon 组织创建专用 PostgreSQL 空库。在第二个本机终端把 Neon 管理员直连地址设置为 `JOURNAL_DB_ADMIN_URL`，保持本机数据库运行，然后执行下面的命令。它会应用迁移、创建受限运行角色，并复制现有本机片单。

   ```powershell
   node --experimental-strip-types scripts/prepare-render.mjs
   ```

3. 在 Render 导入自己的代码仓库，按仓库中的 `render.yaml` 创建 Web Service。依照部署指南设置生产环境变量，或将上一步生成的 `.journal-local/render-production.env` 作为名为 `journal.env` 的 Render Secret File。把管理员连接留在本机，应用只使用受限角色。完整步骤及验收请见[部署指南](./DEPLOY-RENDER.md)。

## 安装到手机或电脑

在两台设备上打开同一生产站点的 HTTPS 地址并登录。

- iPhone 使用 Safari 的“分享 → 添加到主屏幕”。
- Android 使用 Chrome 菜单里的“安装应用”或“添加到主屏幕”。
- 桌面 Chrome 和 Edge 可通过地址栏或菜单安装。

首次在线加载后，断网启动会显示离线提示，片单读写需要联网。

验收同步时，在电脑新增一部测试番剧，用手机刷新并点 `+1`，再回到电脑刷新核对集数。

## 开发检查

```shell
npm test
npm run typecheck
npm run build
```

应用代码在 `src/`，数据库迁移和行级权限策略在 `supabase/migrations/`。Render 部署使用独立开发者账号、服务端会话和 Neon PostgreSQL。环境变量清单见[配置模板](./.env.local.example)。

## 许可证与素材

项目源码采用 [MIT 许可证](./LICENSE)。界面使用 Lucide 图标，适用其 [ISC 及部分 Feather 图标的 MIT 许可](https://lucide.dev/license)。通过 Bangumi 下载或显示的条目信息和封面来自外部服务，相关权利归相应权利人。

登录背景 `public/art/login-station.webp` 是为本项目生成的插画，随项目按同一 [MIT 许可证](./LICENSE) 分发。

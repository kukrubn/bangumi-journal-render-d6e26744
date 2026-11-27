# 番剧手账 · Render 与 Neon

电脑和手机都用生产站点的 HTTPS 地址登录。应用用已有开发者邮箱和密码验证身份，在同一个 Neon PostgreSQL 数据库保存观看进度、笔记和书签。本机 `localhost:3000` 仍使用原来的本地数据库。

## 首次部署

已有 Windows 本机开发者账号时，可在本机终端仅注入 Neon 管理员直连地址 `JOURNAL_DB_ADMIN_URL`，运行 `node --experimental-strip-types scripts/prepare-render.mjs`。脚本完成下面第 1 步并将第 3 步所需的六项生产设置写入已忽略的 `.journal-local/render-production.env`。以 `journal.env` 为文件名上传至专用 Render 服务的 Secret Files 后即可按配置启动。重复运行脚本会复用同一运行角色和会话密钥。

1. 在自己的 Neon 免费组织选择专用空库。保管管理员的非连接池 TLS 地址，将它设为本机迁移进程的 `JOURNAL_DB_ADMIN_URL`。在同库的连接池地址中换上一个新的小写运行角色名及至少 32 位的随机密码，得到 `JOURNAL_DATABASE_URL`。从本机 `.env.local` 取原来的 `JOURNAL_DEV_OWNER`。在本机数据库运行时执行下面两行，核对输出的七张表数量。第二个命令保留目标库已有的记录，遇到冲突会回滚，请在站内 JSON 恢复界面逐条处理。

   ```powershell
   node scripts/cloud-db.mjs --initialize
   node --experimental-strip-types scripts/copy-developer-shelf.mjs
   ```

2. 用个人私有 Git 仓库存放应用源码，将 Render 的仓库访问权限授予这一个仓库。项目根目录的 `render.yaml` 声明了免费 Node Web Service、Node 24、启动命令及健康检查。可通过 Render 的 **New → Blueprint** 使用此配置。托管账号只供部署时使用。[Render 的 Next.js 部署说明](https://render.com/docs/deploy-nextjs-app)
3. 在 Render 的 Environment 设置生产值。沿用本机的 `JOURNAL_DEV_EMAIL`、`JOURNAL_DEV_OWNER`、`JOURNAL_DEV_PASSWORD_HASH` 和 `BANGUMI_USER_AGENT`；`JOURNAL_DATABASE_URL` 使用第 1 步的受限运行角色。Blueprint 自动生成独立的 `JOURNAL_DEV_JWT_SECRET`。CLI 部署也可以将这六项放进仅运行时读取的 `journal.env` Secret File。管理员连接仅供迁移。生产账号配置随环境注入，源码和 Git 历史仅包含变量名称。[Render 密钥配置](https://render.com/docs/configure-environment-variables)
4. 服务达到 **Live** 后，从 Dashboard 复制实际的 `https://…onrender.com` 域名。免费 Web Service 无访问 15 分钟后休眠，再次打开约需一分钟唤醒。片单保存在 Neon，服务重启后仍可读取。[Render 免费服务](https://render.com/docs/free) · [Neon 免费计划](https://neon.com/docs/introduction/plans)

## 两台设备验收

已有较早部署时，保留原有数据库、运行角色、管理员账号和生产环境变量。在本机迁移终端分别设置同库的 `JOURNAL_DB_ADMIN_URL`、已有的 `JOURNAL_DATABASE_URL` 和原 `JOURNAL_DEV_OWNER`，执行 `node scripts/cloud-db.mjs`。脚本按生产迁移记录只执行缺少的版本。邀请注册需要 `20261128000500_invited_accounts.sql`；迁移完成后发布新代码。

管理员可在「设置与数据 → 邀请朋友」生成链接。让朋友用另一浏览器打开链接并设置密码，保存自己的登录号，进入空片单。在自己的另一台设备登录后应能读到同一份数据。管理员原有片单应保持原样。

1. 用电脑打开生产站点并登录，核对原片单。用手机浏览器打开同一地址，也用原来的开发者账号登录。
2. 在电脑新建测试番剧，在手机刷新并点一次 `+1`。回到电脑刷新，应显示同一观看集数。删除测试条目后，手机刷新应同步消失。
3. iPhone 用 Safari 的分享菜单选择“添加到主屏幕”；Android 用 Chrome 菜单选择“安装应用”或“添加到主屏幕”。桌面 Chrome 和 Edge 可从地址栏或菜单安装。首次在线打开后，断网再启动会显示离线提示，联网即可继续读写。

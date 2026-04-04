import { useState } from 'react';
import { BookOpen, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// ─── 截图组件 ─────────────────────────────────────────────────────────────────
function Screenshot({ src, caption }: { src: string; caption: string }) {
  return (
    <div className="my-4 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      <img src={src} alt={caption} className="w-full block" loading="lazy" />
      <div className="bg-gray-50 border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
        {caption}
      </div>
    </div>
  );
}

// ─── 步骤列表 ─────────────────────────────────────────────────────────────────
function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2 my-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 items-start text-sm">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-black text-yellow-400 text-xs font-bold flex items-center justify-center mt-0.5">
            {i + 1}
          </span>
          <span className="text-gray-700" dangerouslySetInnerHTML={{ __html: item }} />
        </li>
      ))}
    </ol>
  );
}

// ─── 提示框 ───────────────────────────────────────────────────────────────────
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-gray-700">
      <span className="font-semibold text-yellow-700">💡 提示：</span> {children}
    </div>
  );
}

// ─── 表格 ─────────────────────────────────────────────────────────────────────
function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-gray-200 text-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-black text-yellow-400">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-xs">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-gray-700 border-t border-gray-100"
                  dangerouslySetInnerHTML={{ __html: cell }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── 可折叠 FAQ 条目 ──────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden mb-2">
      <button
        className="w-full text-left px-4 py-3 font-semibold text-sm flex items-center justify-between bg-white hover:bg-yellow-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {q}
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="px-4 py-3 text-sm text-gray-700 bg-gray-50 border-t border-gray-100"
          dangerouslySetInnerHTML={{ __html: a }} />
      )}
    </div>
  );
}

// ─── 章节标题 ─────────────────────────────────────────────────────────────────
function SectionTitle({ num, title }: { num: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-yellow-400">
      <span className="w-8 h-8 rounded-full bg-yellow-400 border-2 border-black text-black font-black text-sm flex items-center justify-center flex-shrink-0">
        {num}
      </span>
      <h2 className="text-lg font-black text-black">{title}</h2>
    </div>
  );
}

function SubTitle({ title }: { title: string }) {
  return (
    <h3 className="text-base font-bold text-black mb-3 mt-5 pl-3 border-l-4 border-yellow-400">
      {title}
    </h3>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────
export default function GuideDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-black/20 text-gray-700 hover:bg-yellow-100 hover:border-yellow-400 transition-colors"
      >
        <BookOpen className="w-4 h-4 mr-1.5" />
        使用指南
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto p-0"
        >
          {/* 固定顶部标题栏 */}
          <SheetHeader className="sticky top-0 z-10 bg-yellow-400 border-b-2 border-black px-6 py-4 flex flex-row items-center justify-between">
            <SheetTitle className="text-xl font-black text-black flex items-center gap-2">
              <BookOpen size={20} />
              使用指南
            </SheetTitle>
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors"
            >
              <X size={16} />
            </button>
          </SheetHeader>

          {/* 内容区 */}
          <div className="px-6 py-6 space-y-8">

            {/* ── 1. 工具简介 ─────────────────────────────────────────────── */}
            <section>
              <SectionTitle num={1} title="工具简介" />
              <p className="text-sm text-gray-700 mb-3">
                香蕉攀岩运营工具提供两大核心功能，帮助快速制作换线宣传物料：
              </p>
              <Table
                headers={['功能', '用途', '输出格式']}
                rows={[
                  ['<strong>换线海报生成器</strong>', '制作换线活动宣传海报，展示定线员信息、换线时间和区域', 'PNG / PDF（60×90cm 等四种尺寸）'],
                  ['<strong>定线员贴纸生成器</strong>', '为每位定线员生成专属圆形贴纸，用于现场展示或社交媒体', 'PNG（945×945px，8×8cm @300dpi）'],
                ]}
              />
              <Screenshot src="/guide/home.png" caption="工具主界面 — 左侧为信息填写区，右侧为实时预览区" />
            </section>

            {/* ── 2. 换线海报生成器 ────────────────────────────────────────── */}
            <section>
              <SectionTitle num={2} title="换线海报生成器" />

              <SubTitle title="2.1 填写海报信息" />
              <p className="text-sm text-gray-700 mb-2">打开工具后默认进入「换线海报」Tab，左侧面板顶部为海报基础信息填写区：</p>
              <Table
                headers={['字段', '说明', '示例']}
                rows={[
                  ['<strong>标题</strong>', '海报顶部大标题，通常为场馆名称', '香蕉攀石 · 华发中城商都店'],
                  ['<strong>副标题</strong>', '海报副标题，通常为换线活动名称', '2月换线信息'],
                  ['<strong>换线模式</strong>', '选择单次换线或多次换线', '见下方说明'],
                  ['<strong>换线时间表</strong>', '具体换线时间和区域描述', '2月4日 20:00 悬浮岛、比赛墙换线'],
                  ['<strong>闭馆换线</strong>', '开关，是否为闭馆期间换线', '默认关闭'],
                  ['<strong>换线区域</strong>', '本次换线涉及的区域', '全场 / 悬浮岛 / 比赛墙'],
                ]}
              />
              <Screenshot src="/guide/poster_info.png" caption="海报信息填写区 — 单次换线模式" />

              <p className="text-sm font-semibold text-gray-800 mt-4 mb-2">换线模式说明：</p>
              <Table
                headers={['模式', '适用场景', '时间表形式']}
                rows={[
                  ['<strong>单次换线</strong>', '一次性换线活动，时间集中', '自由文本输入框，支持多行'],
                  ['<strong>多次换线</strong>', '跨多天的换线计划，每天分别列出', '结构化日期列表，可逐条添加'],
                ]}
              />
              <Screenshot src="/guide/multi_schedule.png" caption="多次换线模式 — 可逐条添加换线日期和描述" />

              <SubTitle title="2.2 添加定线员" />
              <Steps items={[
                '点击照片上传区，选择定线员照片（支持 JPG、PNG、WebP 格式）<br/><img src="/lainy-example.png" alt="定线员圆形贴纸示例" style="width:140px;height:140px;border-radius:50%;object-fit:cover;margin:10px 0 4px 0;display:block;" /><span style="font-size:11px;color:#888;">请上传定线员圆形贴纸图片</span>',
                '如需 AI 自动抠图去除背景，开启右上角「AI 自动抠图」开关（处理时间约 10–30 秒）',
                '在「名字」输入框填写定线员姓名',
                '在「简介」输入框填写定线员简介和成就（支持换行）',
                '选择「身份」，共四种：<br/>- <strong>特邀国际定线员</strong> (Guest International)<br/>- <strong>特邀国内定线员</strong> (Guest Domestic)<br/>- <strong>香蕉定线员</strong> (Banana Setter)<br/>- <strong>香蕉教练员</strong> (Banana Coach)<br/>不同身份的海报卡片样式会有区别。',
                '在「国籍」下拉菜单选择国籍（可选，选择后显示国旗图标）',
                '点击「+ 添加定线员」按钮完成添加，右侧预览区实时更新',
              ]} />
              <Screenshot src="/guide/climber_form.png" caption="添加定线员表单 — 包含照片上传、姓名、简介、身份和国籍字段" />
              <Tip>建议上传人物在画面中占比适中的照片（人物高度约占图片高度的 60–80%）。若人物过小，可先裁剪原图至合适比例再上传，以获得更好的海报构图效果。</Tip>

              <SubTitle title="2.3 批量导入定线员" />
              <p className="text-sm text-gray-700 mb-2">
                点击「添加定线员」标题右侧的「批量导入」按钮，可一次性添加多位定线员。
                将所有定线员照片和 <code className="bg-gray-100 px-1 rounded text-xs">info.json</code> 文件放在同一文件夹中，直接上传该文件夹或打包为 <code className="bg-gray-100 px-1 rounded text-xs">.zip</code> 压缩包上传。
              </p>
              <Screenshot src="/guide/batch_import.png" caption="批量导入弹窗 — 支持上传文件夹或 ZIP 压缩包" />
              <p className="text-sm font-semibold text-gray-800 mb-1">文件夹结构：</p>
              <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-3 overflow-x-auto mb-3">
{`climbers/          ← 文件夹 或 climbers.zip
├── info.json
├── 张三.jpg
├── 李四.png
└── 王五.webp`}
              </pre>
              <p className="text-sm font-semibold text-gray-800 mb-1">info.json 格式（支持单次/多次换线计划）：</p>
              <p className="text-xs text-gray-600 mb-2">系统会自动识别 JSON 格式。如果是包含多个计划对象的数组，将自动切换为<strong>多次换线模式</strong>，并自动去重定线员。</p>
              <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-3 overflow-x-auto mb-3">
{`[
  {
    "store_name": "香蕉攀岩·华发中城商都店",
    "area_name": "A区",
    "start_date": "2026-04-01",
    "end_date": "2026-04-03",
    "is_closed": false,
    "setters": [
      {
        "id": "setter_001",
        "name": "张三",
        "role": "route_setter",
        "nationality": "CN",
        "photo": "张三.jpg"
      }
    ]
  },
  {
    "store_name": "香蕉攀岩·华发中城商都店",
    "area_name": "B区",
    "start_date": "2026-04-05",
    "end_date": "2026-04-07",
    "is_closed": false,
    "setters": [ ... ]
  }
]`}
              </pre>
              <Table
                headers={['字段', '必填', '说明']}
                rows={[
                  ['<code class="bg-gray-100 px-1 rounded text-xs">store_name</code>', '否', '场馆名称（作为海报大标题）'],
                  ['<code class="bg-gray-100 px-1 rounded text-xs">area_name</code>', '否', '换线区域（多次换线模式下作为描述）'],
                  ['<code class="bg-gray-100 px-1 rounded text-xs">start_date/end_date</code>', '否', '换线开始/结束日期'],
                  ['<code class="bg-gray-100 px-1 rounded text-xs">setters</code>', '是', '定线员数组，包含 id, name, role, photo 等字段'],
                  ['<code class="bg-gray-100 px-1 rounded text-xs">role</code>', '否', '身份：coach, route_setter, invited_domestic, invited_international'],
                ]}
              />
              <Tip>多次换线模式下，如果同一个定线员在多个计划中出现，系统会根据 <code className="bg-gray-100 px-1 rounded text-xs">id</code> 或 <code className="bg-gray-100 px-1 rounded text-xs">name</code> 自动去重。同时，所有定线员将自动按「特邀国际 → 特邀国内 → 香蕉定线员 → 香蕉教练员」的优先级排序。</Tip>

              <SubTitle title="2.4 管理定线员列表" />
              <Table
                headers={['操作', '方法']}
                rows={[
                  ['<strong>调整顺序</strong>', '拖拽定线员卡片左侧的拖拽手柄（⠿ 图标）上下移动'],
                  ['<strong>编辑信息</strong>', '点击定线员卡片右侧的编辑按钮（铅笔图标），修改后点击保存'],
                  ['<strong>删除定线员</strong>', '点击定线员卡片右侧的删除按钮（垃圾桶图标）'],
                  ['<strong>清空全部</strong>', '点击定线员列表标题右侧的「清空」按钮'],
                ]}
              />

              <SubTitle title="2.5 导出设置与下载" />
              <Table
                headers={['设置项', '选项', '说明']}
                rows={[
                  ['<strong>Logo 类型</strong>', '香蕉攀岩 / BANANA+', '选择海报右下角的 Logo 样式'],
                  ['<strong>海报尺寸</strong>', '60×90cm / 60×80cm / 59×79cm / 9:16 手机', '默认 60×90cm，适合标准海报打印；9:16 手机版导出 1080×1920px，适合手机屏幕分享'],
                  ['<strong>文件格式</strong>', 'PNG / PDF', 'PNG 适合数字传播，PDF 适合印刷'],
                ]}
              />
              <Screenshot src="/guide/export_settings.png" caption="导出设置区域 — 选择尺寸和格式后点击下载" />
              <Tip>点击右侧预览区右上角的「下载 PNG」或「下载 PDF」按钮即可下载。大尺寸 PDF 可能需要 5–10 秒生成时间。</Tip>

              <SubTitle title="2.6 历史记录" />
              <p className="text-sm text-gray-700">
                工具会自动保存最近 20 条生成记录到浏览器本地存储。点击页面右上角的「生成记录」按钮可打开历史记录面板，查看并恢复之前的海报配置。
              </p>
              <Tip>历史记录存储在当前浏览器中，清除浏览器缓存或使用其他浏览器/设备访问时历史记录不会同步。</Tip>
            </section>

            {/* ── 3. 贴纸生成器 ───────────────────────────────────────────── */}
            <section>
              <SectionTitle num={3} title="定线员贴纸生成器" />
              <p className="text-sm text-gray-700 mb-3">点击顶部导航的「定线员贴纸」Tab 进入贴纸生成器。</p>
              <Screenshot src="/guide/sticker_page.png" caption="定线员贴纸生成器 — 左侧填写信息，右侧实时预览" />

              <SubTitle title="3.1 生成贴纸" />
              <Steps items={[
                '在「上传照片」区域点击或拖拽上传定线员照片（支持 JPG、PNG、WebP）',
                '在「定线员姓名」输入框填写姓名（将显示在贴纸底部）',
                '在「国籍」区域点击选择国籍（可选，选择后在贴纸底部显示对应国旗）',
                '选择是否开启「AI 自动抠图」（开启后自动去除背景，处理时间约 10–30 秒）',
                '点击「生成贴纸」按钮，等待生成完成',
                '生成完成后，点击右上角「下载 PNG」按钮保存贴纸（945×945px，8×8cm @300dpi）',
              ]} />
              <Tip>系统会自动检测照片中的人脸位置，将人脸定位在圆形贴纸的上方区域，为底部的国旗和姓名标签留出空间。支持正面、侧面、倾斜等多种姿势的人脸检测。</Tip>

              <SubTitle title="3.2 手动调整构图" />
              <p className="text-sm text-gray-700 mb-2">当自动构图效果不理想时，可使用手动调整功能：</p>
              <Steps items={[
                '贴纸生成完成后，点击预览图下方的「手动调整构图」按钮进入调整模式',
                '在圆形预览区内<strong>拖动人物</strong>调整位置（支持鼠标拖拽和触摸滑动）',
                '拖动底部<strong>缩放滑块</strong>（30%–250%）调整人物大小',
                '满意后点击「确认构图」按钮，前端直接合成最终 945×945px PNG',
                '如需恢复自动构图，点击「重置到自动构图」链接',
              ]} />
              <Table
                headers={['操作', '效果']}
                rows={[
                  ['拖动圆形预览区内的人物', '移动人物在贴纸中的位置'],
                  ['底部缩放滑块向左', '缩小人物（最小 30%）'],
                  ['底部缩放滑块向右', '放大人物（最大 250%）'],
                  ['点击「确认构图」', '以当前位置和缩放生成最终贴纸，可下载'],
                  ['点击「重置到自动构图」', '恢复到系统自动计算的初始构图'],
                ]}
              />
              <Tip>无论人物如何移动，底部的国旗和姓名标签始终显示在人物图层上方，不会被遮挡。</Tip>
            </section>

            {/* ── 4. 常见问题 ─────────────────────────────────────────────── */}
            <section>
              <SectionTitle num={4} title="常见问题" />
              <FaqItem
                q="AI 抠图效果不理想，背景没有完全去除怎么办？"
                a="AI 抠图对于背景复杂、人物与背景颜色相近的照片效果可能不佳。建议：<br/>1. 关闭「AI 自动抠图」开关，使用原图（保留背景）生成海报，视觉效果通常也很好；<br/>2. 使用专业抠图工具（如 remove.bg、Photoshop）预处理照片后再上传。"
              />
              <FaqItem
                q="贴纸生成后人脸没有出现在圆形内怎么办？"
                a="这通常发生在照片中人物姿势特殊（如仰视、大幅倾斜）或人脸占图片比例过小的情况下。解决方法：<br/>1. 点击「手动调整构图」按钮，拖动人物到合适位置，调整缩放比例后确认；<br/>2. 或者裁剪原图，使人物在画面中占更大比例后重新上传。"
              />
              <FaqItem
                q="批量导入时提示格式错误怎么办？"
                a="请检查：<br/>1. <code style='background:#f3f4f6;padding:1px 4px;border-radius:3px'>info.json</code> 必须是合法的 JSON 格式，可用在线工具（jsonlint.com）检查；<br/>2. <code style='background:#f3f4f6;padding:1px 4px;border-radius:3px'>photo</code> 字段中的文件名必须与文件夹中的实际文件名完全一致（包括大小写和扩展名）；<br/>3. 如果上传 ZIP 包，请确保文件夹和 info.json 在 ZIP 的第一层目录中，不要有多余的嵌套文件夹。"
              />
              <FaqItem
                q="海报预览正常但下载的 PDF 显示异常怎么办？"
                a="PDF 生成依赖服务器端渲染，偶尔可能出现字体或图片加载延迟。建议：<br/>1. 等待 3–5 秒后再次点击下载；<br/>2. 如果问题持续，可先下载 PNG 格式，再用图片编辑工具转换为 PDF。"
              />
              <FaqItem
                q="历史记录丢失了怎么办？"
                a="历史记录存储在浏览器的 localStorage 中，以下情况会导致丢失：清除浏览器缓存/数据、使用隐私/无痕模式、更换浏览器或设备。建议在生成满意的海报后及时下载保存。"
              />
            </section>

          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

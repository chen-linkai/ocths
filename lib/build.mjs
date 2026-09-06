import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, copyFileSync, cpSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { marked } from "marked";

function md(src) {
  return marked.parse(String(src == null ? "" : src), { gfm: true, breaks: false });
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POSTS_DIR = path.join(ROOT, "posts");
const PAGES_DIR = path.join(ROOT, "pages");
const TPL_DIR = path.join(ROOT, "templates");
const OUT_DIR = path.join(ROOT, "build");
const COPY_DIRS = ["css", "img"];
const COPY_FILES = ["favicon.ico"];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fill(tpl, map) {
  let s = tpl;
  for (const [k, v] of Object.entries(map)) s = s.split("{{" + k + "}}").join(v);
  return s;
}
function loadConfig() {
  return JSON.parse(readFileSync(path.join(ROOT, "config.json"), "utf-8"));
}

function hashOf(rel) {
  const abs = path.join(ROOT, String(rel || ""));
  return existsSync(abs) ? createHash("sha1").update(readFileSync(abs)).digest("hex").slice(0, 10) : "";
}
function versioned(rel) {
  rel = String(rel || "").trim();
  if (!rel || rel.includes("?")) return rel;
  const h = hashOf(rel);
  return h ? rel + "?v=" + h : rel;
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*:|#|\/|data:)/i;
function rootify(html, depth) {
  if (!depth) return html;
  const pre = "../".repeat(depth);
  return html.replace(/\s(src|href|poster)="([^"]*)"/gi, (m, a, v) => {
    const x = v.trim();
    if (x && !SCHEME_RE.test(x) && !x.startsWith("./") && !x.startsWith("../")) return " " + a + '="' + pre + x + '"';
    return m;
  });
}

function fingerprintLocal(rel) {
  rel = String(rel || "").trim();
  if (!rel || SCHEME_RE.test(rel) || rel.startsWith(".") || rel.includes("?")) return rel;
  return versioned(rel);
}
function fingerprintContent(html) {
  return html.replace(/\s(src|href|poster)="([^"]*)"/gi, (m, a, v) => {
    const x = v.trim();
    if (!x || SCHEME_RE.test(x) || x.startsWith(".") || x.includes("?")) return m;
    return " " + a + '="' + fingerprintLocal(x) + '"';
  });
}

function normRoot(r) {
  r = String(r == null ? "" : r).trim();
  if (!r) return "";
  if (!r.startsWith("/")) r = "/" + r;
  if (!r.endsWith("/")) r += "/";
  return r;
}

function topDir(key) {
  return { about: "about/", contact: "contact/", terms: "terms/", search: "search/" }[key] || key + "/";
}
function makeRefs(pre) {
  return {
    home: pre === "" ? "./" : "../",
    page: (key) => pre + topDir(key),
    cat: (key) => pre + "news/cat-" + key + ".html",
  };
}

function splitFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] && lines[0].trim() === "---") {
    for (let k = 1; k < lines.length; k++) {
      if (lines[k].trim() === "---") {
        const meta = {};
        for (const raw of lines.slice(1, k)) {
          const t = raw.trim();
          if (!t || t.startsWith("#")) continue;
          const i = t.indexOf(":");
          if (i > 0) meta[t.slice(0, i).trim().toLowerCase()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
        }
        return [meta, lines.slice(k + 1).join("\n")];
      }
    }
  }
  return [{}, text];
}
function parseDate(v) {
  const m = String(v).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? { y: m[1], m: m[2].padStart(2, "0"), d: m[3].padStart(2, "0") } : null;
}
function fileStem(f) { return f.replace(/\.md$/i, ""); }

function loadPosts(cfg) {
  const posts = [];
  if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true });
  const cats = (cfg.categories || []).length ? cfg.categories : [{ key: "news", label: "新闻投稿" }];
  const byLabel = {};
  for (const c of cats) byLabel[c.label] = c;
  const fallback = cats[0];

  for (const f of readdirSync(POSTS_DIR).sort()) {
    if (!/\.md$/i.test(f) || f.startsWith("_")) continue;
    const [meta, body] = splitFrontMatter(readFileSync(path.join(POSTS_DIR, f), "utf-8"));
    if (String(meta.draft || "").toLowerCase() in { true: 1, yes: 1, "1": 1 }) { continue; }
    const date = parseDate(meta.date) || parseDate(fileStem(f));
    if (!date) { continue; }

    const labelRaw = (meta.category || fallback.label).trim();
    const cat = byLabel[labelRaw] || fallback;
    const s = fileStem(f);
    const dateDisplay = date.y + "-" + date.m + "-" + date.d;
    const title = (meta.title || "").trim() || s.replace(/^\d{4}-\d{2}-\d{2}-?/, "").replace(/-/g, " ");
    const author = (meta.author || "").trim();
    const imageRaw = (meta.image || "").trim();
    const contentHtml = fingerprintContent(md(body || "*（正文待补充）*"));

    let summary = (meta.summary || "").trim();
    if (!summary) {
      const plain = contentHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      summary = plain.length > 90 ? plain.slice(0, 90) + "…" : plain;
    }
    if (!summary) summary = title;

    posts.push({
      stem: s, url: "news/" + s + ".html",
      catKey: cat.key, catLabel: cat.label,
      title, author, summary, contentHtml, dateDisplay,
      day: date.d, month: date.y + "-" + date.m, year: date.y,
      image: imageRaw,
      imageV: imageRaw ? fingerprintLocal(imageRaw) : "",
    });
  }
  posts.sort((a, b) => b.dateDisplay.localeCompare(a.dateDisplay) || b.stem.localeCompare(a.stem));
  return posts;
}

function loadPages(cfg) {
  const pages = [];
  if (!existsSync(PAGES_DIR)) mkdirSync(PAGES_DIR, { recursive: true });
  const cfgPage = {};
  for (const p of cfg.pages || []) cfgPage[p.key] = p;
  for (const f of readdirSync(PAGES_DIR).sort()) {
    if (!/\.md$/i.test(f)) continue;
    const key = fileStem(f);
    const [meta, body] = splitFrontMatter(readFileSync(path.join(PAGES_DIR, f), "utf-8"));
    const c = cfgPage[key] || {};
    pages.push({
      key, url: topDir(key), out: key + "/index.html",
      label: c.label || meta.title || key,
      title: (meta.title || c.label || key).trim(),
      summary: (meta.summary || "").trim(),
      contentHtml: fingerprintContent(md(body || "")),
    });
  }
  return pages;
}

function navHtml(cfg, pages, refs, active) {
  const li = (url, label, isActive, hasSub) =>
    '<li class="' + (hasSub ? "has-sub " : "") + (isActive ? "active" : "") + '"><a ' +
    (hasSub ? 'class="top" ' : "") + 'href="' + url + '">' + esc(label) + "</a>";
  const sub = (url, label) => "<li><a href=\"" + url + '">' + esc(label) + "</a></li>";

  let html = '<ul class="navlist">';
  html += li(refs.home, "首页", active === "home", false) + "</li>";

  const aboutPages = (cfg.pages || []).filter(p => p.key !== "contact");
  if (aboutPages.length > 1) {
    html += li(refs.page(aboutPages[0].key), "走进侨高", active === "about", true) +
      '<ul class="subnav">' + aboutPages.map(p => sub(refs.page(p.key), p.label)).join("") + "</ul></li>";
  } else if (aboutPages.length === 1) {
    const p = aboutPages[0];
    html += li(refs.page(p.key), p.label, active === "about", false) + "</li>";
  }

  const first = (cfg.categories || [])[0] || { key: "news" };
  html += li(refs.cat(first.key), "新闻资讯", active === "news", true) +
    '<ul class="subnav">' + (cfg.categories || []).map(c => sub(refs.cat(c.key), c.label)).join("") + "</ul></li>";

  const contact = (cfg.pages || []).find(p => p.key === "contact");
  if (contact) html += li(refs.page(contact.key), contact.label, active === "contact", false) + "</li>";

  return html + "</ul>";
}

function activeKey(page) {
  if (page === "home") return "home";
  if (page === "list" || page === "article") return "news";
  if (page === "contact") return "contact";
  if (page === "about") return "about";
  return "";
}

function shellHtml(cfg, o) {
  const tpl = readFileSync(path.join(TPL_DIR, "base.html"), "utf-8");
  const pre = o.pre;
  const refs = makeRefs(pre);
  const root = normRoot(cfg.root);

  const cssV = versioned("css/style.css");
  const icoV = versioned("favicon.ico");
  const logoV = versioned("img/logo.webp");

  const brand =
    '<img class="brand-logo" src="' + pre + logoV + '" alt="' + esc(cfg.siteShort) + '">' +
    '<span class="brand-text"><b class="brand-name">' + esc(cfg.siteShort) + "</b>" +
    "</span>";

  const contact = cfg.contact.map(([l, v]) => "<li><span>" + esc(l) + "：</span>" + esc(v) + "</li>").join("\n");
  const links = cfg.friendLinks.map(([n, u]) => '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(n) + "</a>").join("");

  const fLinks = (cfg.pages || []).filter(p => p.key !== "contact")
    .map(p => "<li><a href=\"" + refs.page(p.key) + '">' + esc(p.label) + "</a></li>").join("");
  const fNews = (cfg.categories || []).map(c => "<li><a href=\"" + refs.cat(c.key) + '">' + esc(c.label) + "</a></li>").join("");

  const baseTag = o.page === "notfound" && root
    ? '    <base href="' + esc(root) + '">\n'
    : "";

  return fill(tpl, {
    TITLE: o.title,
    META_DESC: o.desc,
    FAVICON: pre + icoV,
    CSS: pre + cssV,
    PAGE: o.page,
    BASE: baseTag,
    BRAND: brand,
    HOME: refs.home,
    SEARCH_URL: refs.page("search"),
    TERMS_URL: refs.page("terms"),
    SITE_SHORT: esc(cfg.siteShort),
    SITE_FULL: esc(cfg.siteFull),
    NAV: navHtml(cfg, o.pages, refs, activeKey(o.page)),
    CONTENT: o.content,
    DISCLAIMER: esc(cfg.disclaimer || "") + '（<a href="' + refs.page("terms") + '">《使用条款》</a>）',
    CONTACT: contact,
    LINKS: links,
    F_LINKS: fLinks,
    F_NEWS: fNews,
    ICP: esc(cfg.icp || ""),
    ICP_URL: esc(cfg.icpUrl || "#"),
  });
}

function pageBanner(title, sub) {
  return '<section class="page-banner"><div class="container page-banner-inner">' +
    "<h1>" + esc(title) + "</h1>" +
    (sub ? '<p class="banner-sub">' + esc(sub) + "</p>" : "") + "</div></section>";
}

function newsListItem(post, pre) {
  return (
    '<article class="news-item">' +
    (post.imageV
      ? '<a class="news-thumb" href="' + pre + post.url + '"><img src="' + pre + post.imageV + '" alt="' + esc(post.title) + '" loading="lazy"></a>'
      : "") +
    '<div class="news-main">' +
    '<h2 class="news-title"><a href="' + pre + post.url + '">' + esc(post.title) + "</a></h2>" +
    '<p class="news-summary">' + esc(post.summary) + "</p>" +
    '<div class="news-meta"><time datetime="' + esc(post.dateDisplay) + '">' + esc(post.dateDisplay) + "</time>" +
    (post.author ? "<span>发布：" + esc(post.author) + "</span>" : "") +
    '<a class="read-more" href="' + pre + post.url + '">阅读全文 →</a></div>' +
    "</div></article>"
  );
}

function homePage(cfg, posts, pages) {
  const pre = "";
  const refs = makeRefs(pre);
  const heroImg = versioned(cfg.heroImage || "");
  const hero =
    '<section class="hero"' + (heroImg ? ' style="background-image:url(\'' + esc(heroImg) + '\')"' : "") + ">" +
    '<div class="hero-inner"><h1 class="hero-title">' + esc(cfg.siteShort) + "</h1></div></section>";

  const catNews = posts.filter(p => p.catKey === "news");
  const first = (cfg.categories || [])[0] || { key: "news" };
  const featured = catNews.filter(p => p.imageV).slice(0, 3);
  const featSet = new Set(featured.map(p => p.stem));
  const rest = catNews.filter(p => !featSet.has(p.stem)).slice(0, 6);

  const featHtml = featured.length
    ? '<div class="feat-grid">' + featured.map(p =>
        '<a class="feat" href="' + p.url + '"><span class="feat-img"><img src="' + p.imageV + '" alt="' + esc(p.title) + '" loading="lazy"></span>' +
        '<span class="feat-t">' + esc(p.title) + "</span>" +
        '<span class="feat-date">' + esc(p.dateDisplay) + "</span></a>"
      ).join("") + "</div>"
    : "";
  const restHtml = rest.length
    ? '<ul class="dot-list">' + rest.map(p =>
        '<li><a href="' + p.url + '"><span class="txt">' + esc(p.title) + '</span><span class="date">' + p.dateDisplay.slice(5) + "</span></a></li>"
      ).join("") + "</ul>"
    : "";
  const newsCol =
    '<div class="col"><div class="sec-head"><h2>新闻投稿</h2>' +
    '<a class="more" href="' + refs.cat(first.key) + '">更多 →</a></div>' +
    (featHtml || '<p class="muted empty-tip">暂无内容</p>') + restHtml + "</div>";

  const catNotices = posts.filter(p => p.catKey === "notices").slice(0, 7);
  const noticeHtml = catNotices.length
    ? '<ul class="dot-list">' + catNotices.map(p =>
        '<li><a href="' + p.url + '"><span class="txt">' + esc(p.title) + '</span><span class="date">' + p.dateDisplay.slice(5) + "</span></a></li>"
      ).join("") + "</ul>"
    : '<p class="muted empty-tip">暂无公告</p>';
  const noticesCol =
    '<div class="col col-side"><div class="sec-head"><h2>通知公告</h2>' +
    '<a class="more" href="' + refs.cat("notices") + '">更多 →</a></div>' + noticeHtml + "</div>";

  const content =
    hero +
    '<section class="section"><div class="container"><div class="home-grid">' + newsCol + noticesCol + "</div></div></section>";

  return shellHtml(cfg, {
    page: "home", pre, pages, title: cfg.siteFull, desc: cfg.siteDesc, content,
  });
}

function singlePage(cfg, page, pages) {
  const pre = "../";
  const active = page.key === "contact" ? "contact" : "about";
  const content =
    pageBanner(page.title, page.summary) +
    '<section class="section"><div class="container"><div class="article-card">' +
    '<div class="article-content">' + rootify(page.contentHtml, 1) + "</div></div></div></section>";
  return shellHtml(cfg, {
    page: active, pre, pages, title: page.title + " - " + cfg.siteFull, desc: page.summary || cfg.siteFull, content,
  });
}

function categoryPage(cfg, list, pages, cat) {
  const pre = "../";
  const items = list.map(p => newsListItem(p, pre)).join("");
  const content =
    pageBanner(cat.label, "共 " + list.length + " 篇") +
    '<section class="section"><div class="container">' +
    (list.length ? '<div class="news-list">' + items + "</div>" : '<div class="empty-state">暂无内容。</div>') +
    "</div></section>";
  return shellHtml(cfg, {
    page: "list", pre, pages, title: cat.label + " - " + cfg.siteFull,
    desc: cfg.siteFull + " " + cat.label, content,
  });
}

function articlePage(cfg, post, pages) {
  const pre = "../";
  const content =
    pageBanner(post.title, post.catLabel + " · " + post.dateDisplay + (post.author ? " · 发布：" + post.author : "")) +
    '<article class="article-wrap"><div class="container article-inner">' +
    (post.imageV
      ? '<figure class="article-cover"><img src="' + pre + post.imageV + '" alt="' + esc(post.title) + '"></figure>'
      : "") +
    '<div class="article-card"><div class="article-content">' + rootify(post.contentHtml, 1) + "</div></div>" +
    '<div class="article-actions"><a class="btn btn-ghost" href="' + pre + 'news/cat-' + post.catKey + '.html">← 返回' + esc(post.catLabel) + "</a>" +
    '<a class="btn btn-backtop" href="#top">返回顶部 ↑</a></div>' +
    "</div></article>";
  return shellHtml(cfg, {
    page: "article", pre, pages, title: post.title + " - " + cfg.siteFull, desc: post.summary, content,
  });
}

function searchPage(cfg, posts, pages) {
  const pre = "../";
  const refs = makeRefs(pre);
  const data = posts.map(p => ({ title: p.title, date: p.dateDisplay, category: p.catLabel, summary: p.summary, url: p.url, author: p.author }));
  const content =
    pageBanner("搜索结果", "已收录 " + posts.length + " 条内容") +
    '<section class="section"><div class="container">' +
    '<p class="muted search-hint" id="hint" style="display:none"></p>' +
    '<div id="results" class="news-list"></div>' +
    '<div class="search-empty" id="noQ"><p class="muted">未输入关键词。</p>' +
    '<p><a class="btn btn-ghost" href="' + refs.home + '">← 返回首页</a></p></div>' +
    "</div></section>";
  const html = shellHtml(cfg, {
    page: "search", pre, pages, title: "搜索 - " + cfg.siteFull, desc: cfg.siteFull + " 站内搜索", content,
  });

  const script = [
    "<script>",
    "var __RAW__ = " + JSON.stringify(data) + ";",
    "window.__POSTS__ = __RAW__.map(function(p){ p.url = '../' + p.url; return p; });",
    "(function () {",
    '  var hint = document.getElementById("hint"), res = document.getElementById("results"), noQ = document.getElementById("noQ");',
    '  function strip(s){ return String(s==null?"":s).replace(/[<>&"]/g,""); }',
    "  function render(list){",
    '    noQ.style.display = "none";',
    "    if(!list.length){ res.innerHTML = '<div class=\"empty-state\">没有找到相关内容，请用页头搜索框换个关键词试试。</div>'; return; }",
    "    res.innerHTML = list.map(function(p){",
    "      return '<article class=\"news-item\"><div class=\"news-main\">'+",
    "        '<h2 class=\"news-title\"><a href=\"'+p.url+'\">'+strip(p.title)+'</a></h2>'+",
    "        '<p class=\"news-summary\">'+strip(p.summary)+'</p>'+",
    "        '<div class=\"news-meta\"><span class=\"news-cat\">'+strip(p.category)+'</span><time>'+strip(p.date)+'</time></div>'+",
    "        '</div></article>';",
    "    }).join('');",
    "  }",
    "  var m = location.search.match(/[?&]q=([^&]+)/);",
    '  var kw = m ? decodeURIComponent(m[1].replace(/\\+/g," ")).trim() : "";',
    '  if(!kw){ noQ.style.display = ""; return; }',
    "  var k = kw.toLowerCase();",
    "  var hit = window.__POSTS__.filter(function(p){",
    '    return (p.title+" "+p.summary+" "+p.category+" "+(p.author||"")).toLowerCase().indexOf(k) !== -1;',
    "  });",
    '  hint.style.display = "";',
    '  hint.textContent = "关键词「"+kw+"」找到 "+hit.length+" 条结果：";',
    "  render(hit);",
    "})();",
    "</script>"
  ].join("\n");
  return html.replace("</body>", script + "</body>");
}

function notFoundPage(cfg, pages) {
  const pre = "";
  const content =
    '<section class="section section-404"><div class="container center">' +
    '<h1 class="nf-code">404</h1><p class="nf-text">您访问的页面不存在或已被移除。</p>' +
    '<p><a class="btn btn-ghost" href="index.html">← 返回首页</a></p></div></section>';
  return shellHtml(cfg, {
    page: "notfound", pre, pages, title: "页面不存在 - " + cfg.siteFull, desc: "页面不存在", content,
  });
}

function rssFeed(cfg, posts) {
  const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const first = (cfg.categories[0] || { key: "news" });
  const items = posts.map(p => {
    const [y, m, d] = p.dateDisplay.split("-").map(Number);
    return "<item><title>" + x(p.title) + "</title><link>" + x(p.url) + "</link><guid>" + x(p.url) +
      "</guid><pubDate>" + new Date(Date.UTC(y, m - 1, d)).toUTCString() + "</pubDate><category>" +
      x(p.catLabel) + "</category><description>" + x(p.summary) + "</description></item>";
  }).join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>' +
    "<title>" + x(cfg.siteFull + " · 新闻") + "</title><link>news/cat-" + first.key + ".html</link>" +
    "<description>" + x(cfg.siteFull) + "</description><language>zh-cn</language>" +
    items + "</channel></rss>\n"
  );
}
function sitemapXml(posts, pages, cfg) {
  const urls = ["index.html", "search/"];
  for (const c of cfg.categories || []) urls.push("news/cat-" + c.key + ".html");
  for (const p of pages) urls.push(p.url);
  for (const p of posts) urls.push(p.url);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map(u => "<url><loc>" + u + "</loc></url>").join("") + "</urlset>\n"
  );
}

function copyStatic() {
  for (const n of COPY_DIRS) if (existsSync(path.join(ROOT, n))) cpSync(path.join(ROOT, n), path.join(OUT_DIR, n), { recursive: true });
  for (const n of COPY_FILES) if (existsSync(path.join(ROOT, n))) copyFileSync(path.join(ROOT, n), path.join(OUT_DIR, n));
}
function write(p, s) {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, s, "utf-8");
}

function main() {
  const cfg = loadConfig();
  const posts = loadPosts(cfg);
  const pages = loadPages(cfg);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  write(path.join(OUT_DIR, "index.html"), homePage(cfg, posts, pages));

  for (const c of cfg.categories || []) {
    const list = posts.filter(p => p.catKey === c.key);
    write(path.join(OUT_DIR, "news", "cat-" + c.key + ".html"), categoryPage(cfg, list, pages, c));
  }

  for (const p of posts) write(path.join(OUT_DIR, p.url), articlePage(cfg, p, pages));

  for (const p of pages) write(path.join(OUT_DIR, p.out), singlePage(cfg, p, pages));

  write(path.join(OUT_DIR, "search", "index.html"), searchPage(cfg, posts, pages));
  write(path.join(OUT_DIR, "404.html"), notFoundPage(cfg, pages));

  writeFileSync(path.join(OUT_DIR, "feed.xml"), rssFeed(cfg, posts), "utf-8");
  writeFileSync(path.join(OUT_DIR, "sitemap.xml"), sitemapXml(posts, pages, cfg), "utf-8");

  copyStatic();
}

main();

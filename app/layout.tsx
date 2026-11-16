import type { Metadata } from "next";
import "./globals.css";
import "./lacivert.css";

export const metadata: Metadata = {
  title: "Maliye-Finans",
  description: "KB Group maliye ve finans yönetimi uygulaması.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// Deploy sırasında (eski ve yeni konteyner birkaç saniye birlikte çalışırken)
// ya da uzun süre açık kalmış bir sekmede, sayfanın istediği /_next/static (eski: /assets) altındaki .js/.css
// dosyası artık sunucuda olmayabilir → 404, boş/bozuk ekran. Bu küçük betik
// böyle bir yükleme hatasını yakalar ve sayfayı bir kez yeniler. Sabit bir
// metindir (kullanıcı verisi içermez); sessionStorage zamanı sayesinde 30 sn
// içinde ikinci kez yenilemez, yani döngüye girmez.
const ASSET_RECOVERY_SCRIPT = `(function(){var K="mfv01-asset-reload";function r(){try{var l=Number(sessionStorage.getItem(K))||0;if(Date.now()-l<30000)return;sessionStorage.setItem(K,String(Date.now()))}catch(e){return}setTimeout(function(){location.reload()},1500)}window.addEventListener("error",function(e){var t=e.target;if(t&&(t.tagName==="SCRIPT"||t.tagName==="LINK")){var u=t.src||t.href||"";if(u.indexOf("/_next/static/")>=0||u.indexOf("/assets/")>=0)r()}},true);window.addEventListener("vite:preloadError",function(e){e.preventDefault();r()});window.addEventListener("unhandledrejection",function(e){var m=String((e.reason&&e.reason.message)||e.reason||"");if(/dynamically imported module|Importing a module script failed/i.test(m))r()})})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <head>
        <script dangerouslySetInnerHTML={{ __html: ASSET_RECOVERY_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

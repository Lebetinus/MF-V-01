"use client";

import { useState, type ReactNode } from "react";
import { Title } from "./shared";
import { tx } from "../lib/i18n";
import type { Language } from "../lib/types";

// Kullanım Kılavuzu — kendi sol menü girişi (Ayarlar'ın hemen altında),
// tamamen statik/bilgilendirici bir sayfa, gerçek bir veri kaynağına bağlı
// değil. Örnekler kurgusal bir şirket ("Örnek A.Ş.") üzerinden anlatılır;
// burada hiçbir gerçek kullanıcı verisi görünmez. Her başlık/metin tx() ile
// üç dile de (tr/en/ku) bağlı — dil değiştirildiğinde içerik de değişir.
export function Guide({ language }: { language: Language }) {
  type GuideTopic = { id: string; title: string; body: ReactNode };
  const topics: GuideTopic[] = [
    {
      id: "overview",
      title: tx(language, "Genel Bakış", "Overview", "Nêrîna Giştî"),
      body: (
        <>
          <p>
            {tx(
              language,
              "Maliye-Finans; kasalarınızı, gelirlerinizi ve giderlerinizi tek bir yerden yönetmenizi sağlar. Aşağıdaki örnekler kurgusal bir şirket olan \"Örnek A.Ş.\" üzerinden anlatılmıştır — burada gerçek bir veri yoktur.",
              "Maliye-Finans lets you manage your cash accounts, income and expenses in one place. The examples below use a fictional company, \"Örnek A.Ş.\" — nothing here is real data.",
              "Maliye-Finans dihêle hûn qase, dahat û mesrefên xwe ji cîhekî bi rêve bibin. Mînakên jêrîn bi rêya kompaniyeke xeyalî \"Örnek A.Ş.\" hatine vegotin — li vir tu daneyên rastîn tune ne.",
            )}
          </p>
          <p>
            {tx(
              language,
              "Sol menüden Kasalar, Gelir, Gider, Rapor Hazırla, Mali Özel Notlarım, Yorumlar, Arşiv, Kullanıcılar ve Ayarlar bölümlerine ulaşabilirsiniz. Her bölüm, yalnızca yetkiniz olan verileri gösterir.",
              "The left menu gives you access to Kasalar (Cash), Gelir (Income), Gider (Expense), Rapor Hazırla (Prepare Report), Mali Özel Notlarım (Private Notes), Yorumlar (Comments), Arşiv (Archive), Kullanıcılar (Users) and Ayarlar (Settings). Each section only shows data you're permitted to see.",
              "Ji menuya çepê hûn dikarin bigihîjin beşên Qase, Dahat, Mesref, Raporê Amade Bike, Nîşeyên Min ên Taybet, Şîrove, Arşîv, Bikarhêner û Mîheng. Her beş tenê daneyên ku destûra we jê heye nîşan dide.",
            )}
          </p>
        </>
      ),
    },
    {
      id: "cash",
      title: tx(language, "Kasalar", "Cash Accounts", "Qase"),
      body: (
        <>
          <p>
            {tx(
              language,
              "Bir kasa, fiziksel veya sanal bir para havuzunu temsil eder — örneğin \"Örnek A.Ş. — Merkez Kasa\" veya \"Örnek A.Ş. — Şube Kasası\". Yeni bir kasa açmak için Kasa Kontrol Merkezi'nde \"Yeni Kayıt › Kasa Ekle\" ile Yeni Kasa penceresini açıp kasanın adını ve çalışma alanını girin; isteğe bağlı açılış bakiyesi kasaya \"Açılış bakiyesi\" başlıklı bir gelir kaydı olarak eklenir. Kasadaki her kayıt ya gelir ya giderdir.",
              "A kasa represents a physical or virtual pool of money — e.g. \"Örnek A.Ş. — Head Office\" or \"Örnek A.Ş. — Branch\". To open a new one, use \"New Record › Add Cash Account\" in the Cash Control Center and enter its name and workspace; an optional opening balance is added as an income record titled \"Açılış bakiyesi\". Every record in a cash account is either income or expense.",
              "Qasek berhevoka pere ya fîzîkî an sanal temsîl dike — mînak \"Örnek A.Ş. — Navenda Sereke\" an \"Örnek A.Ş. — Şaxê\". Ji bo vekirinê, di Navenda Kontrola Qaseyan de \"Qeyda Nû › Qase Zêde Bike\" bitikîne û nav û qada xebatê binivîse; bakiya destpêkê ya bijarte wek tomareke dahatê bi sernavê \"Açılış bakiyesi\" tê zêdekirin. Her tomara qaseyê an dahat an mesref e.",
            )}
          </p>
          <p>
            {tx(
              language,
              "Bir kasaya tıkladığınızda o kasanın toplam gelir/gider dökümünü ve bakiyesini görürsünüz. Kasalar > Paylaş ile kendi kasanızı başka bir kullanıcıyla salt-okunur paylaşabilirsiniz; sizinle paylaşılan bir kasayı başkasıyla paylaşamazsınız.",
              "Clicking a kasa shows its full income/expense breakdown and balance. Use Kasalar > Share to give another user read-only access to your own cash account; a cash account shared with you cannot be shared on.",
              "Dema hûn li qasekê bitikînin, tevahiya dahat/mesref û bakiya wê xuya dike. Bi Qase > Parve Bike hûn dikarin qaseya xwe bi bikarhênerekî din re tenê-xwendinê parve bikin; qaseyek ku bi we re hatiye parvekirin nayê parvekirin.",
            )}
          </p>
        </>
      ),
    },
    {
      id: "records",
      title: tx(language, "Gelir / Gider Kayıtları", "Income / Expense Records", "Qeydên Dahat / Mesref"),
      body: (
        <>
          <p>
            {tx(
              language,
              "Örnek: Örnek A.Ş. Eylül ayında \"Ofis Kirası\" için 15.000 ₺ gider, \"Danışmanlık Geliri\" için 40.000 ₺ gelir kaydı girebilir. Her kayıtta tarih, ana başlık, tutar/para birimi ve isteğe bağlı olarak kişi, birim adı, detay ve etiketler bulunur.",
              "Example: in September, Örnek A.Ş. might log a 15,000 ₺ \"Office Rent\" expense and a 40,000 ₺ \"Consulting Income\" income record. Every record has a date, category, amount/currency, and optionally a person, unit name, detail and tags.",
              "Mînak: Örnek A.Ş. di îlonê de dikare mesrefek 15.000 ₺ ji bo \"Kirêya Ofîsê\" û dahatek 40.000 ₺ ji bo \"Dahata Şêwirmendiyê\" têxe. Her qeyd tarîx, sernav, meblağ/pere û bi dilxwazî kes, nav, hûrgilî û etîketan digire.",
            )}
          </p>
          <p>
            {tx(
              language,
              "Bir gelir/gider kaydını bir kasaya bağlamak için \"Kasa Seç\" alanını kullanın — böylece o tutar, ilgili kasanın bakiyesine yansır.",
              "Use \"Select Cash Account\" to link an income/expense record to a kasa — its amount then reflects in that kasa's balance.",
              "Ji bo qeydek dahat/mesref bi qasekê ve girê bidin, \"Qase Hilbijêre\" bikar bînin — meblağ dê di bakiya wê qasê de xuya bibe.",
            )}
          </p>
        </>
      ),
    },
    {
      id: "debts",
      title: tx(language, "Borç", "Debts", "Deyn"),
      body: (
        <>
          <p>
            {tx(
              language,
              "Bir kasa (genellikle ana / sermaye kasası) başka bir kasaya (örneğin bir proje kasasına) borç verebilir. Borç Detay sayfasında \"＋ Borç ver\" ile ya da kasanın sayfasındaki \"Borç ver\" düğmesiyle borç veren kasayı, borç alan kasayı, tutarı ve para birimini seçin. Örnek: Örnek A.Ş. — Merkez Kasa, Şube Kasası'na 10.000 $ borç verir.",
              "One kasa (usually the main / capital kasa) can lend money to another (e.g. a project kasa). On the Debt Details page use \"＋ Lend\", or the \"Lend\" button on the kasa's page, and pick the lending kasa, the borrowing kasa, the amount and the currency. Example: Örnek A.Ş. — Head Office lends $10,000 to the Branch kasa.",
              "Qaseyek (bi gelemperî qaseya sereke / sermiyanê) dikare deyn bide qaseyeke din (mînak qaseya projeyekê). Li rûpela Hûrguliyên Deynê \"＋ Deyn bide\" an jî bişkoka \"Deyn bide\" ya li rûpela qaseyê bikar bînin û qaseya deyndêr, qaseya deyndar, mîqdar û diravê hilbijêrin.",
            )}
          </p>
          <p>
            {tx(
              language,
              "Her işlem iki kasaya birlikte yazılır: borç veren kasada gider, borç alan kasada gelir. Geri ödeme de böyledir (\"Borç öde\" ya da Borç Detay'daki \"Ödeme yap\"): borçlu kasada gider, alacaklı kasada tahsilat. Ödeme kalan borcu aşamaz. Kayıtlardan birini silmek karşı kasadaki kaydı da siler.",
              "Every operation is written to both kasas at once: an expense in the lending kasa and income in the borrowing kasa. Repaying works the same way (\"Repay debt\", or \"Make payment\" on Debt Details): an expense in the debtor kasa and a collection in the creditor kasa. A payment cannot exceed the remaining debt. Deleting one of the records also deletes its counterpart in the other kasa.",
              "Her karûbar bi hev re di her du qaseyan de tê nivîsandin: mesref di qaseya deyndêr de, dahat di qaseya deyndar de. Vegerandin jî wisa ye: mesref di qaseya deyndar de, berhevkirin di qaseya deyndêr de. Dravdan nikare ji deynê mayî zêdetir be. Jêbirina qeydekê qeyda din jî jê dibe.",
            )}
          </p>
          <p>
            {tx(
              language,
              "Borç veren kasa sermaye gibidir: verdiği borç ve geri aldığı tahsilat gelir/gider istatistiğine girmez, yalnız bakiyesini değiştirir; borç ödendikçe bakiyesi eski haline döner. Borç alan kasada ise alınan borç gelir, geri ödeme gider sayılır. Kasa sayfasındaki \"Borç durumu\" kutusu verilen / geri alınan / alacak ve alınan / ödenen / kalan borç rakamlarını gösterir; kayıt tablolarında borç kayıtlarının yanında \"Borç\" rozeti görünür.",
              "The lending kasa works like capital: the money it lends and collects back is not counted in its income/expense statistics, it only moves its balance, which returns to where it was as the debt is repaid. In the borrowing kasa the borrowed money counts as income and the repayment as expense. The \"Debt status\" box on a kasa's page shows lent / collected / receivable and borrowed / repaid / remaining; debt records carry a \"Debt\" badge in the record tables.",
              "Qaseya deyndêr wek sermiyanê ye: deynê dide û distîne nakeve statîstîka dahat/mesrefê, tenê balansê diguherîne. Di qaseya deyndar de deynê hatî girtin dahat e, vegerandin mesref e. Qutiya \"Rewşa deynê\" ya li rûpela qaseyê van hejmaran nîşan dide; qeydên deynê di tabloyan de nîşana \"Deyn\" digirin.",
            )}
          </p>
          <p>
            {tx(
              language,
              "Borç alan kasa / proje sistemde yoksa (örneğin C.GROUP, T.ÇİFTLİĞİ gibi proje kasaları) \"Borç ver\" penceresinde \"Sistem dışı kasa / proje\" seçin, adını yazın; parayı alan kişinin adı kayıt bilgisi olarak girilir. Bu borç yalnız borç veren kasaya yazılır: bakiye düşer, gider sayılmaz. Daha önce gider olarak girilmiş bir kaydı kasa sayfasındaki ⇄ düğmesiyle \"Borca çevir\"in; tutarı, tarihi ve kişisi aynen kalır. Borç geri ödenince kasa sayfasındaki \"Borç tahsil et\" ya da Borç Detay'daki \"Tahsil et\" ile girin: para kasa bakiyesine döner, ek gelir sayılmaz. Gelir olarak girilmiş bir geri ödeme de ⇄ ile tahsilat olarak işaretlenebilir.",
              "If the borrowing kasa / project is not in the system (e.g. project kasas such as C.GROUP), choose \"Kasa / project outside the system\" in the \"Lend\" window and type its name; the person who received the money is kept as information. Such a debt is written only to the lending kasa: the balance drops, but it is not an expense. An expense entered earlier can be turned into a debt with the ⇄ button on the kasa page; its amount, date and person stay. When it is repaid, use \"Collect debt\" on the kasa page or \"Collect\" on Debt Details: the money returns to the balance without counting as extra income. A repayment entered as income can be marked as a collection with ⇄ too.",
              "Heke qase / projeya deyndar di sîstemê de tune be (mînak C.GROUP), di pencereya \"Deyn bide\" de \"Qase / projeya derveyî sîstemê\" hilbijêrin û navê wê binivîsin; navê kesê ku pere girt wek agahî tê tomarkirin. Ev deyn tenê di qaseya deyndêr de tê nivîsandin: balans kêm dibe, wek mesref nayê hesibandin. Mesrefeke berê bi bişkoka ⇄ dikare bibe deyn. Dema deyn vegere, bi \"Deyn bistîne\" pere vedigere balansê û wek dahata zêde nayê hesibandin.",
            )}
          </p>
        </>
      ),
    },
    {
      id: "kasaBoxes",
      title: tx(language, "Gelir, Gider ve Kasa Kutuları", "Income, Expense and Cash Boxes", "Qutiyên Dahat, Mesref û Qaseyê"),
      body: (
        <>
          <p>
            {tx(
              language,
              "Her gelir ve gider bir kasaya bağlı girilir. Gelir ve Gider sayfalarında ilk satırda \"Tüm Gelirler/Giderler\" kutusunun sağında kayıt başlığı kutuları ve kasa kutuları (ör. \"Ana Kasa Giderleri\") yer alır; başlık kutularında bağlı kasa küçük bir etiketle görünür. Kutunun adının yanındaki parantezdeki sayı kayıt sayısıdır. Kasa kutusuna tıklayınca tablo o kasanın kayıtlarıyla süzülür.",
              "Every income and expense is entered against a cash account. On the Income and Expense pages the first row has the \"All Income/Expenses\" box followed by record-title boxes and cash-account boxes (e.g. \"Main Cash Expenses\"); title boxes show their linked cash account as a small tag. The number in parentheses next to a name is the record count. Clicking a cash-account box filters the table to that account's records.",
              "Her dahat û mesref bi qaseyekê ve tê tomarkirin. Di rûpelên Dahat û Mesref de di rêza yekem de li rastê qutiya \"Hemû Dahat/Mesref\" qutiyên sernavê û qutiyên qaseyê (mînak \"Mesrefên Qaseya Sereke\") hene; di qutiyên sernavê de qaseya girêdayî bi etîketeke biçûk xuya dibe. Hejmara di nav parantezê de li kêleka navê hejmara qeydan e. Bi tikandina qutiya qaseyê tablo bi qeydên wê qaseyê tê parzûnkirin.",
            )}
          </p>
          <p>
            {tx(
              language,
              "Kasalar sayfasında her kasa kartı o kasanın geliri (↗), gideri (↘) ve sonucunu gösterir; \"Tüm Kasalar\" kutusu da aynı satırlara sahiptir. Geliri ya da gideri olmayan (tutarı sıfır) kasa kutuları Gelir/Gider sayfalarında gizlenir.",
              "On the Kasalar page each cash card shows that account's income (↗), expense (↘) and result; the \"All Cash Accounts\" box has the same lines. Cash boxes with a zero amount are hidden on the Income/Expense pages.",
              "Di rûpela Qase de her karta qaseyê dahat (↗), mesref (↘) û encama wê qaseyê nîşan dide; qutiya \"Hemû Qase\" jî heman rêzan heye. Qutiyên qaseyê yên mîqdara wan sifir e di rûpelên Dahat/Mesref de têne veşartin.",
            )}
          </p>
        </>
      ),
    },
    {
      id: "sectionsTools",
      title: tx(language, "Çalışma Alanları, Kasa Seçimi ve Tablo Araçları", "Workspaces, Cash Selection and Table Tools", "Qadên Xebatê, Hilbijartina Qaseyê û Amûrên Tabloyê"),
      body: (
        <ul>
          <li>
            {tx(
              language,
              "Çalışma Alanları: Kasalar sayfasında kasalar çalışma alanları başlığı altında görünür. Üstte “Tüm Kasalar” kutusu ve hemen yanında her çalışma alanı kendi renginde bir kutu olarak yer alır; bir çalışma alanına tıklayınca kasaları altında açılır, bir kasaya tıklayınca o kasanın gelir ve gider kayıtları iki tabloda görünür. Hazır bir çalışma alanı yoktur: Proje Kasaları, Şirketler gibi alanları Kasalar sayfasındaki “＋ Çalışma Alanı Ekle” düğmesinden ya da Ayarlar > Çalışma Alanları'ndan siz oluşturursunuz; her alanın içinde bölümler (ör. “Projeler › 2026”) açabilirsiniz. Alanlar ve bölümler yalnızca kasaları gruplar; kasalar arasında üst/alt bağı kurmaz. Her kasa bir çalışma alanında (ya da bölümünde) açılır: Yeni Kasa penceresinde “Çalışma alanı” seçilir; mevcut bir kasayı seçip ⇄ “Çalışma alanına taşı” düğmesiyle başka bir alana taşıyabilirsiniz. Alan başlığına tıklayınca tablo o alanın kasalarına göre süzülür. İçinde kasa olan bir alan silinirken kasaları başka bir alana taşınır; kasa ve kayıtlar silinmez.",
              "Workspaces: on the Kasalar page cash accounts appear under workspace headings. “All Cash Accounts” sits on top with each workspace as its own colored box next to it; click a workspace to open its cash accounts below, then click a cash account to see its income and expense records in two tables. There are no built-in workspaces: you create workspaces such as Project Cash Accounts or Companies with “＋ Add Workspace” on the Kasalar page or under Settings > Workspaces, and you can open sections inside each (e.g. “Projects › 2026”). Workspaces and sections only group cash accounts; they create no parent/child link between them. Every cash account opens in a workspace (or one of its sections): pick “Workspace” in the New Cash Account window; to change it later, select the cash account and use the ⇄ “Move to workspace” button. Clicking a workspace heading filters the table to its cash accounts. When a workspace that still holds cash accounts is deleted, its accounts are moved to another workspace first; no cash account or record is deleted.",
              "Qadên Xebatê: di rûpela Qase de qase di bin sernavên qadên xebatê de xuya dibin. Li jor “Hemû Qase” giştiya giştî nîşan dide; li jêr her qada xebatê sernavek û qutiyên qaseyê yên bi rengê xwe heye. Qadeke amade tune: qadên wekî Qaseyên Projeyê an Şirket hûn bi “＋ Qada Xebatê Zêde Bike” an di Mîheng > Qadên Xebatê de çêdikin, û di her qadê de dikarin beşan vekin. Qad û beş tenê qaseyan kom dikin. Ji bo girêdana qaseyekê, di pencereya Qaseya Nû de “Qada xebatê” hilbijêrin. Bi tikandina sernavê tablo li gorî qaseyên wê qadê tê parzûnkirin. Jêbirina qadê qase û tomaran jê nabe.",
            )}
          </li>
          <li>
            {tx(
              language,
              "Ana Sayfa kasa seçimi: “Gelir – Gider Analizi” bölümündeki “Kasa seç” düğmesiyle bir veya birden çok kasa seçin; gelir, gider ve net analizi ile kasa bazında sonuçlar seçime göre yenilenir. “Tümünü göster” seçimi temizler.",
              "Home page cash selection: use the “Select cash accounts” button in “Income – Expense Analysis” to pick one or more cash accounts; the income, expense and net analysis and per-account results refresh to match. “Show all” clears the selection.",
              "Hilbijartina qaseyê ya Rûpela Sereke: bi bişkoka “Qase hilbijêre” di “Analîza Dahat û Mesrefan” de qaseyek an çend qaseyan hilbijêrin; analîz û encamên li gorî qaseyê li gorî hilbijartinê têne nûkirin. “Hemûyan nîşan bide” hilbijartinê paqij dike.",
            )}
          </li>
          <li>
            {tx(
              language,
              "Sütun genişliği: Arşiv ve Rapor tablolarında, başlığın sağ kenarındaki tutamacı sürükleyerek sütunu daraltıp genişletebilirsiniz (çift tıklama sıfırlar, ayar hatırlanır). Kasalar/Gelir/Gider tablolarında sütunlar başlıktan sürüklenerek hem sıralanır hem genişletilir.",
              "Column width: in the Archive and Report tables, drag the handle on a header's right edge to narrow or widen a column (double-click resets, settings are remembered). In the Kasalar/Income/Expense tables columns are reordered and resized by dragging the header.",
              "Firehiya stûnê: di tabloyên Arşîv û Raporê de tutamaka li kêleka rastê ya sernavê bikişînin da stûn teng an fireh bibe (du caran bitikînin vedigere, mîheng tê bîranîn). Di tabloyên Qase/Dahat/Mesref de stûn bi kişandina sernavê tên rêzkirin û fireh kirin.",
            )}
          </li>
          <li>
            {tx(
              language,
              "Hücre hesabı (Excel gibi): Kasalar, Gelir, Gider, Arşiv ve Rapor tablolarında, örneğin Miktar sütununda hücrelere tıklayıp aşağı doğru sürükleyerek seçin (Ctrl ile tek tek, Shift ile aralık). Altta Seçili, Toplam, Ortalama, Sayı, En az ve En çok görünür; Esc veya ✕ ile kapanır.",
              "Cell calculations (like Excel): in the Kasalar, Income, Expense, Archive and Report tables, click and drag down over cells, e.g. in the Amount column (Ctrl for single cells, Shift for a range). A bar at the bottom shows Selected, Sum, Average, Count, Min and Max; close it with Esc or ✕.",
              "Hesaba şaneyan (wekî Excel): di tabloyên Qase, Dahat, Mesref, Arşîv û Raporê de, mînak di stûna Mîqdar de bi tikandin û kişandina ber bi jêr şaneyan hilbijêrin (Ctrl ji bo yek bi yek, Shift ji bo navber). Li jêr Hilbijartî, Giştî, Navîn, Hejmar, Kêmtirîn û Zêdetirîn tê dîtin; bi Esc an ✕ tê girtin.",
            )}
          </li>
        </ul>
      ),
    },
    {
      id: "excelImport",
      title: tx(language, "Excel'den Kasa Aktar", "Import a Cash Account from Excel", "Qaseyekê ji Excelê Têxe"),
      body: (
        <>
          <p>
            {tx(
              language,
              "Kasalar sayfasındaki \"⇧ Excel'den Kasa Aktar\" düğmesi, gelir ve gider sayfaları olan bir Excel dosyasını (Kürtçe başlıklar dahil) seçtiğiniz kasaya aktarır. Dosya tarayıcıda okunur; onaylamadan hiçbir şey kaydedilmez.",
              "The \"⇧ Import Cash from Excel\" button on the Kasalar page imports an Excel file with income and expense sheets (Kurdish headers included) into the cash account you choose. The file is read in the browser; nothing is saved until you confirm.",
              "Bişkoka \"⇧ Qase ji Excelê Têxe\" a di rûpela Qase de pelê Excel yê bi rûpelên dahat û mesrefê (sernavên Kurdî jî) têxe qaseya hilbijartî. Pel di gerokê de tê xwendin; heta hûn erê nekin tu tişt nayê tomarkirin.",
            )}
          </p>
          <ul>
            <li>
              {tx(
                language,
                "1) Dosya ve kasa: .xlsx dosyasını seçin, çalışma alanını ve hedef kasayı seçin ya da yeni kasa adı yazın (yeni kasa seçili alanda açılır).",
                "1) File and cash account: choose the .xlsx file, pick the workspace and the target cash account, or type a new name (a new account opens in the chosen workspace).",
                "1) Pel û qase: pela .xlsx hilbijêrin, qada xebatê û qaseya armanc hilbijêrin an navekî nû binivîsin (qaseya nû di qada hilbijartî de vedibe).",
              )}
            </li>
            <li>
              {tx(
                language,
                "2) Sayfalar ve sütunlar: her tablo (yan yana gelir/gider tabloları dahil) Gelir, Gider veya Yok say olarak tahmin edilir; sütunlar Kürtçe başlıklardan eşleşir ve \"Sütunlar\" ile elle değiştirilebilir. Gizli sayfalar varsayılan olarak aktarılmaz. Özet sayfalarındaki sayılar kontrol için gösterilir.",
                "2) Sheets and columns: each table (including side-by-side income/expense tables) is guessed as Income, Expense or Ignore; columns are matched from Kurdish headers and can be changed by hand under \"Columns\". Hidden sheets are not imported by default. Numbers from summary sheets are shown for checking.",
                "2) Rûpel û stûn: her tablo (tabloyên dahat/mesrefê yên li kêleka hev jî) wekî Dahat, Mesref an Paşguh bike tê texmînkirin; stûn ji sernavên Kurdî têne hevber kirin û bi \"Stûn\" bi destî dikarin werin guhertin. Rûpelên veşartî bi gelemperî nayên barkirin. Hejmarên rûpelên kurte ji bo kontrolê têne nîşandan.",
              )}
            </li>
            <li>
              {tx(
                language,
                "3) Önizleme ve aktarım: kayıt sayısı, gelir ve gider toplamı ve ilk kayıtlar görünür. Aynı fatura numaralı satırlar tek kayıtta toplanır (ürün satırları \"Detay\" tablosuna girer); sayfa adı Proje olarak yazılabilir; ay/gün ters okunmuş şüpheli tarihler düzeltilebilir.",
                "3) Preview and import: record count, income and expense totals and the first records are shown. Rows with the same invoice number are combined into one record (item rows go to the \"Detail\" table); the sheet name can be written as Project; suspicious day/month-swapped dates can be fixed.",
                "3) Pêşdîtin û barkirin: hejmara qeydan, hejmara dahat û mesrefê û qeydên yekem têne nîşandan. Rêzên bi heman hejmara fatûreyê di yek qeydê de têne civandin (berhem diçin tabloya \"Hûrgulî\"); navê rûpelê dikare wekî Proje were nivîsandin; dîrokên bi guman ên roj/meh berevajî dikarin werin rastkirin.",
              )}
            </li>
            <li>
              {tx(
                language,
                "Güvenlik: aynı dosya tekrar yüklenirse daha önce aktarılan satırlar atlanır; aktarım bittiğinde \"Geri al\" ile tüm aktarım silinebilir. Suriye lirası (SYP) para birimi desteklenir.",
                "Safety: if the same file is uploaded again, rows already imported are skipped; when the import finishes you can remove the whole import with \"Undo\". The Syrian pound (SYP) currency is supported.",
                "Ewlehî: heke heman pel dîsa were barkirin, rêzên berê hatine barkirin têne bihurandin; piştî barkirinê bi \"Vegerîne\" hemû barkirin dikare were jêbirin. Dirava lîreya Sûriyê (SYP) tê piştgirîkirin.",
              )}
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "expenseDetail",
      title: tx(language, "Gider Detay Tablosu", "Expense Detail Table", "Tabloya Hûrguliyên Mesrefê"),
      body: (
        <p>
          {tx(
            language,
            "Gider kaydında \"Gider Detaylarını Görüntüle\" bölümüne Excel veya Google Sheets'ten kopyaladığınız tabloyu Ctrl+V (ya da \"⎘ Yapıştır\") ile yapıştırabilirsiniz. Hücreleri düzenleyebilir, satır/sütun başlığına sağ tıklayıp ekleyip silebilir, başlık kenarlarından genişlik/yükseklik ayarlayabilir ve hücre hizalamasını (sola/ortaya/sağa, üste/ortaya/alta) araç çubuğundan seçebilirsiniz. Kayıttan sonra satırdaki \"Detay\" düğmesi tabloyu genişletilebilir bir pencerede gösterir; tablo panoya kopyalanabilir veya Excel'e aktarılabilir.",
            "In an expense record you can paste a table copied from Excel or Google Sheets into \"View Expense Details\" with Ctrl+V (or \"⎘ Paste\"). You can edit cells, right-click a row/column header to insert or delete, drag header edges to change width/height, and choose cell alignment (left/center/right, top/middle/bottom) from the toolbar. After saving, the row's \"Detail\" button shows the table in an expandable window; it can be copied to the clipboard or exported to Excel.",
            "Di qeydeke mesrefê de hûn dikarin tabloya ji Excel an Google Sheets hatiye kopîkirin di beşa \"Hûrguliyên Mesrefê Nîşan Bide\" de bi Ctrl+V (an \"⎘ Bi cih bike\") bi cih bikin. Hûn dikarin şaneyan biguherînin, bi tikandina rastê ya li ser sernavê rêz/stûnê zêde bikin û jê bibin, bi kişandina kêleka sernavê firehî/bilindî ayar bikin û rastkirina şaneyê ji darika amûran hilbijêrin. Piştî tomarkirinê bişkoka \"Hûrgulî\" tabloyê di paceyeke fireh dibe de nîşan dide; dikare ji panoyê re were kopîkirin an ji Excelê re were derxistin.",
          )}
        </p>
      ),
    },
    {
      id: "attachments",
      title: tx(language, "Ek Dosyalar", "Attachments", "Peldankên Pêvekirî"),
      body: (
        <p>
          {tx(
            language,
            "Bir kayda Excel, Word, PowerPoint veya PDF dosyası ekleyebilirsiniz (en fazla 5 dosya, dosya başına ~6MB). PDF ve CSV/Excel dosyaları uygulama içinde önizlenebilir; diğer dosya türleri \"İndir\" ile bilgisayarınıza kaydedilir.",
            "You can attach Excel, Word, PowerPoint or PDF files to a record (up to 5 files, ~6MB each). PDF and CSV/Excel files can be previewed inside the app; other file types are saved to your computer via \"Download\".",
            "Hûn dikarin pelên Excel, Word, PowerPoint an PDF li qeydekê zêde bikin (herî zêde 5 pel, ~6MB ji bo her pelî). Pelên PDF û CSV/Excel dikarin di hundirê sepanê de werin pêşdîtin; cureyên din bi \"Daxîne\" li ser kompîturê tên tomarkirin.",
          )}
        </p>
      ),
    },
    {
      id: "notes",
      title: tx(language, "Mali Özel Notlar", "Private Finance Notes", "Nîşeyên Taybet ên Darayî"),
      body: (
        <>
          <p>
            {tx(
              language,
              "Örnek: \"Örnek A.Ş. — Ekim ayı KDV beyannamesi son 3 gün içinde verilmeli\" gibi hatırlatıcı notlar burada tutulur. Bir not birden fazla kullanıcıya atanabilir, durumu (Önemli/Acil/Bekleyen/Tamamlanmış) değiştirilebilir.",
              "Example: reminders like \"Örnek A.Ş. — the October VAT return is due within 3 days\" live here. A note can be assigned to several users at once and moved between statuses (Important/Urgent/Pending/Completed).",
              "Mînak: bîrxistinên wek \"Örnek A.Ş. — beyana KDV'yê ya cotmehê divê di 3 rojan de were dayin\" li vir tên girtin. Nîşeyek dikare bi hevdemî ji çend bikarhêneran re were vekirin û di navbera rewşan (Girîng/Acîl/Li Bendê/Qediyayî) de were guhastin.",
            )}
          </p>
          <p>
            {tx(
              language,
              "Okunmamış notlar sol menüdeki rozetle ve kart üzerindeki mavi noktayla gösterilir. Artık ihtiyacınız kalmayan bir notu silmek yerine \"Arşivle\" ile panodan kaldırabilirsiniz — arşivlenen notlar Arşiv > Notlar Arşivi'nde kalıcı olarak durur.",
              "Unread notes are marked with a badge on the sidebar and a blue dot on the card. Instead of deleting a note you no longer need active, use \"Archive\" to remove it from the board — archived notes stay permanently under Arşiv > Notlar Arşivi.",
              "Nîşeyên nexwendî bi rozeteke li menuya kêlekê û xalek şîn a li ser kartê tên nîşandan. Li şûna jêbirina nîşeyek ku êdî ne pêwîst e, bi \"Arşîv Bike\" wê ji panoyê rake — nîşeyên arşîvkirî bi awayekî daîmî di Arşîv > Arşîva Nîşeyan de dimînin.",
            )}
          </p>
        </>
      ),
    },
    {
      id: "comments",
      title: tx(language, "Yorumlar", "Comments", "Şîrove"),
      body: (
        <p>
          {tx(
            language,
            "Herhangi bir kasa/gelir/gider kaydına, o satırdaki 💬 simgesinden yorum ekleyebilirsiniz — örneğin \"Bu fatura muhasebeciye iletildi mi?\" gibi. \"⚠️ Dikkat\" işaretli yorumlar ayrı bir sekmede toplanır. Artık güncel olmayan bir konuşmayı \"Arşivle\" ile ana listeden kaldırabilirsiniz; Arşiv > Yorumlar Arşivi'nde özet olarak kalır.",
            "Add a comment to any kasa/income/expense record from the 💬 icon on its row — e.g. \"Has this invoice been sent to the accountant?\". Comments flagged \"⚠️ Attention\" are collected in a separate tab. Use \"Archive\" to remove a stale conversation from the main list; it stays as a summary under Arşiv > Yorumlar Arşivi.",
            "Ji sembola 💬 ya li ser rêzê, hûn dikarin şîroveyekê li her qeydek qase/dahat/mesref zêde bikin — mînak \"Ev fatûre gihîşt hesabdêr?\". Şîroveyên bi nîşana \"⚠️ Balkêşî\" di hilfirînek cuda de tên civandin. Bi \"Arşîv Bike\" hûn dikarin sohbetek ne-rojane ji lîsteya sereke rakin; ew wek kurte di Arşîv > Arşîva Şîroveyan de dimîne.",
          )}
        </p>
      ),
    },
    {
      id: "archive",
      title: tx(language, "Arşiv", "Archive", "Arşîv"),
      body: (
        <p>
          {tx(
            language,
            "Arşiv; düzenlenen/silinen kasa kayıtlarını, hazırlanan raporları, arşivlenmiş özel notları ve arşivlenmiş yorum konularını tek bir yerde, yıl/birim/kasa/bölüm filtreleriyle listeler. Hiçbir şey kalıcı olarak kaybolmaz.",
            "Arşiv lists edited/deleted cash records, prepared reports, archived private notes and archived comment threads in one place, filterable by year/unit/kasa/section. Nothing is ever permanently lost.",
            "Arşîv qeydên qase yên hatine guherandin/jêbirin, raporên amadekirî, nîşeyên taybet ên arşîvkirî û mijarên şîroveyê yên arşîvkirî li cîhekî, bi fîltreyên sal/yekîne/qase/beş dide xuyakirin. Tu tişt bi awayekî daîmî winda nabe.",
          )}
        </p>
      ),
    },
    {
      id: "reports",
      title: tx(language, "Rapor Hazırla", "Prepare Report", "Raporê Amade Bike"),
      body: (
        <p>
          {tx(
            language,
            "Belirli bir tarih aralığındaki gelir/gider kayıtlarını seçip \"Örnek A.Ş. — 3. Çeyrek Mali Raporu\" gibi imzalı, sunuma hazır bir rapor oluşturabilirsiniz. Hazırlanan raporlar Arşiv'de saklanır.",
            "Select income/expense records within a date range to build a signed, presentation-ready report like \"Örnek A.Ş. — Q3 Financial Report\". Prepared reports are kept in Arşiv.",
            "Hûn dikarin qeydên dahat/mesref ên di navbereke tarîxê de hilbijêrin û raporeke îmzekirî, amade ji bo pêşkêşkirinê wek \"Örnek A.Ş. — Rapora Darayî ya Sê Mehî\" çêbikin. Raporên amade li Arşîvê tên parastin.",
          )}
        </p>
      ),
    },
    {
      id: "users",
      title: tx(language, "Kullanıcılar ve Yetkiler", "Users & Permissions", "Bikarhêner û Destûr"),
      body: (
        <p>
          {tx(
            language,
            "Bir yönetici, örneğin \"Örnek A.Ş. Muhasebe\" rolündeki bir kullanıcıya sadece Gelir ve Gider sayfalarına erişim izni verebilir; \"Örnek A.Ş. Denetim\" rolündeki bir kullanıcıya ise sadece Arşiv'i salt-okunur açabilir. Her kullanıcı, Kullanıcılar sayfasından kendi adını ve şifresini güncelleyebilir.",
            "An admin can, for example, grant a user with the \"Örnek A.Ş. Accounting\" role access only to Gelir and Gider, while an \"Örnek A.Ş. Audit\" role only sees Arşiv read-only. Every user can update their own name and password from Kullanıcılar.",
            "Rêvebirek dikare, mînak, bikarhênerekî bi rola \"Hesabdariya Örnek A.Ş.\" tenê destûra Dahat û Mesrefê bide; bikarhênerekî bi rola \"Denetleme Örnek A.Ş.\" jî tenê Arşîvê bi tenê-xwendinê vebike. Her bikarhêner dikare navê xwe û şîfreya xwe ji Bikarhêner biguherîne.",
          )}
        </p>
      ),
    },
    {
      id: "settings",
      title: tx(language, "Ayarlar", "Settings", "Mîheng"),
      body: (
        <p>
          {tx(
            language,
            "Ayarlar'dan şirket adını/logosunu, yazı tipi ve renk tercihlerini, engellenen IP listesini ve (süper admin için) Ana Sayfa'da hangi paylaşılan kasaların birleştirileceğini yönetebilirsiniz. Veri (Database) Ayarları'ndan tüm verilerinizi JSON olarak dışa/içe aktarabilirsiniz.",
            "Ayarlar lets you manage the company name/logo, font and color preferences, the blocked-IP list, and (for super admins) which shared kasas get merged into Ana Sayfa. Database Settings lets you export/import all your data as JSON.",
            "Ji Mîhengan hûn dikarin navê/logoya kompaniyê, tercîhên curenivîs û rengî, lîsteya IP'yên astengkirî û (ji bo super-admin) kîjan qaseyên parvekirî di Rûpela Sereke de tên yekbûn bi rêve bibin. Ji Mîhengên Danegehê hûn dikarin hemû daneyên xwe wek JSON derxin/têxin.",
          )}
        </p>
      ),
    },
  ];
  const [topicId, setTopicId] = useState(topics[0].id);
  // Dil değişince seçili konu başlığı aynı kalır ama metni ilgili dile
  // otomatik döner — çünkü topics dizisi her render'da language'a göre
  // yeniden kuruluyor, hardcoded bir kopya tutulmuyor.
  const active = topics.find((t) => t.id === topicId) ?? topics[0];
  return (
    <div className="panel">
      <Title
        title={tx(language, "Kullanım Kılavuzu", "User Guide", "Rêbera Bikaranînê")}
        sub={tx(
          language,
          "Uygulamanın bölümleri ve nasıl kullanılacağı — örnekler kurgusaldır, gerçek veri içermez",
          "The app's sections and how to use them — examples are fictional, no real data is shown",
          "Beşên sepanê û çawa bêne bikaranîn — mînak xeyalî ne, tu daneya rastîn nîşan nadin",
        )}
      />
      <div className="commentSplitView guideSplitView">
        <div className="commentSplitList guideTopicList">
          {topics.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`commentListItem${topicId === t.id ? " active" : ""}`}
              onClick={() => setTopicId(t.id)}
            >
              <span className="commentListItemHead">
                <strong>{t.title}</strong>
              </span>
            </button>
          ))}
        </div>
        <div className="commentSplitDetail guideTopicDetail">
          <article className="commentCard">
            <header>
              <div>
                <strong>{active.title}</strong>
              </div>
            </header>
            <div className="guideBody">{active.body}</div>
          </article>
        </div>
      </div>
    </div>
  );
}

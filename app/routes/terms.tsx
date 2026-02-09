import { ArrowLeft } from "lucide-react";
import { useLocation } from "react-router";
import type { Language } from "~/types/settings";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

export default function Terms() {
  const { pathname } = useLocation();
  const lang: Language = pathname.endsWith("/ja") ? "ja" : "en";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <main className="mx-auto max-w-3xl px-4 py-16">
        <div className="mb-8 flex items-center justify-between">
          <a
            href={lang === "ja" ? "/lp/ja" : "/lp"}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft size={16} />
            Back
          </a>
          <LanguageSwitcher lang={lang} basePath="/terms" />
        </div>

        {lang === "ja" ? <TermsJa /> : <TermsEn />}
      </main>
    </div>
  );
}

function TermsEn() {
  return (
    <>
      <h1 className="mb-8 text-3xl font-bold text-gray-900 dark:text-gray-50">Terms of Service</h1>
      <div className="prose prose-gray max-w-none dark:prose-invert text-gray-700 dark:text-gray-300 [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:dark:text-gray-100 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_p]:mb-4 [&_p]:leading-relaxed">
        <p>
          These Terms of Service (hereinafter referred to as &ldquo;these Terms&rdquo;) set forth the conditions of use for GemiHub (hereinafter referred to as &ldquo;the Service&rdquo;) provided by <a href="https://takeshy.work" className="text-blue-600 hover:underline dark:text-blue-400">takeshy.work</a> (hereinafter referred to as &ldquo;the Company&rdquo;). Users (hereinafter referred to as &ldquo;Users&rdquo;) shall use the Service upon agreeing to these Terms.
        </p>

        <h2>Article 1 (Application)</h2>
        <ol>
          <li>These Terms shall apply to all relationships between Users and the Company regarding the use of the Service.</li>
          <li>In addition to these Terms, the Company may establish various rules and regulations (hereinafter referred to as &ldquo;Individual Provisions&rdquo;) regarding the use of the Service. Regardless of their titles, such Individual Provisions shall constitute a part of these Terms.</li>
          <li>If the provisions of these Terms conflict with the Individual Provisions of the preceding article, the Individual Provisions shall take precedence unless otherwise specified in the Individual Provisions.</li>
        </ol>

        <h2>Article 2 (User Registration)</h2>
        <ol>
          <li>To use the Service, prospective users shall register by agreeing to these Terms and authenticating through their Google account.</li>
          <li>The Company may decline a registration application if it determines that any of the following reasons apply, and shall not be obligated to disclose the reasons:
            <ol>
              <li>If the application is from a person who has previously violated these Terms</li>
              <li>If the Company otherwise deems the registration inappropriate</li>
            </ol>
          </li>
        </ol>

        <h2>Article 3 (Account Management)</h2>
        <ol>
          <li>Users shall manage their Service accounts (including Google account integration) appropriately under their own responsibility.</li>
          <li>The Company shall not be liable for any damages arising from a User&apos;s account being used by a third party, except in cases of the Company&apos;s intentional or gross negligence.</li>
        </ol>

        <h2>Article 4 (Data Storage and Management)</h2>
        <ol>
          <li>Data created and managed through the Service is stored in the User&apos;s own Google Drive. The Company does not store User data on its servers.</li>
          <li>Users shall also comply with the terms of service of Google Drive and Google APIs.</li>
          <li>Users shall manage any Gemini API keys they configure under their own responsibility.</li>
        </ol>

        <h2>Article 5 (Prohibited Activities)</h2>
        <p>Users shall not engage in any of the following activities when using the Service:</p>
        <ol>
          <li>Activities that violate laws or public order and morals</li>
          <li>Activities related to criminal acts</li>
          <li>Activities that destroy or interfere with the servers or network functions of the Company, other Users of the Service, or third parties</li>
          <li>Activities that may interfere with the operation of the Service</li>
          <li>Unauthorized access or attempts thereof</li>
          <li>Impersonating other Users</li>
          <li>Activities that infringe on the intellectual property rights, privacy, reputation, or other rights or interests of the Company, other Users, or third parties</li>
        </ol>

        <h2>Article 6 (Suspension of Service)</h2>
        <ol>
          <li>The Company may suspend or interrupt all or part of the Service without prior notice to Users if it determines that any of the following reasons exist:
            <ol>
              <li>When performing maintenance or updates on the computer systems related to the Service</li>
              <li>When the provision of the Service becomes difficult due to force majeure such as earthquakes, lightning, fire, power outages, or natural disasters</li>
              <li>When computers or communication lines are stopped due to an accident</li>
              <li>When the Company otherwise determines that providing the Service is difficult</li>
            </ol>
          </li>
          <li>The Company shall not be liable for any disadvantage or damage suffered by Users or third parties due to the suspension or interruption of the Service.</li>
        </ol>

        <h2>Article 7 (Copyright)</h2>
        <ol>
          <li>Users may only use the Service to submit or upload content such as text, images, or videos for which they hold the necessary intellectual property rights or have obtained the required permissions from the rights holders.</li>
          <li>The copyright of text, images, videos, and other content created and saved using the Service shall be retained by the User or other existing rights holders.</li>
        </ol>

        <h2>Article 8 (Usage Restrictions and Account Deletion)</h2>
        <ol>
          <li>The Company may restrict a User&apos;s use of all or part of the Service, or delete a User&apos;s registration, without prior notice, if any of the following apply:
            <ol>
              <li>If the User has violated any provision of these Terms</li>
              <li>If the Company otherwise deems the User&apos;s use of the Service inappropriate</li>
            </ol>
          </li>
          <li>The Company shall not be liable for any damages arising from actions taken under this article.</li>
        </ol>

        <h2>Article 9 (Disclaimer of Warranties)</h2>
        <ol>
          <li>The Company does not warrant, either expressly or implicitly, that the Service is free from defects in fact or in law (including defects relating to safety, reliability, accuracy, completeness, validity, fitness for a particular purpose, security, errors, bugs, or rights infringement).</li>
          <li>The Company shall not be liable for any damages incurred by Users arising from the Service, except in cases of the Company&apos;s intentional or gross negligence.</li>
          <li>The Service uses the Google Gemini API, and the Company does not guarantee the accuracy of AI-generated results.</li>
        </ol>

        <h2>Article 10 (Changes to Service Content)</h2>
        <p>The Company may change, add to, or discontinue the content of the Service with prior notice to Users, and Users shall accept this.</p>

        <h2>Article 11 (Changes to Terms of Service)</h2>
        <ol>
          <li>The Company may change these Terms without requiring individual consent from Users in the following cases:
            <ol>
              <li>When the changes are in the general interest of Users</li>
              <li>When the changes do not contradict the purpose of the Service agreement and are reasonable in light of the necessity, appropriateness, and other circumstances of the changes</li>
            </ol>
          </li>
          <li>The Company shall notify Users in advance of changes to these Terms, including the fact that the Terms will be changed, the content of the changed Terms, and the effective date of such changes.</li>
        </ol>

        <p className="mt-10 text-sm text-gray-400 dark:text-gray-500">Last updated: March 16, 2025</p>
      </div>
    </>
  );
}

function TermsJa() {
  return (
    <>
      <h1 className="mb-8 text-3xl font-bold text-gray-900 dark:text-gray-50">利用規約</h1>
      <div className="prose prose-gray max-w-none dark:prose-invert text-gray-700 dark:text-gray-300 [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:dark:text-gray-100 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_p]:mb-4 [&_p]:leading-relaxed">
        <p>
          この利用規約（以下、「本規約」といいます）は、株式会社<a href="https://takeshy.work" className="text-blue-600 hover:underline dark:text-blue-400">takeshy.work</a>（以下、「当社」といいます）が提供するGemiHub（以下、「本サービス」といいます）の利用条件を定めるものです。ユーザーの皆様（以下、「ユーザー」といいます）には、本規約に同意いただいた上で、本サービスをご利用いただきます。
        </p>

        <h2>第1条（適用）</h2>
        <ol>
          <li>本規約は、ユーザーと当社との間の本サービスの利用に関わる一切の関係に適用されるものとします。</li>
          <li>当社は本サービスに関し、本規約のほか、ご利用にあたってのルール等、各種の定め（以下、「個別規定」といいます）をすることがあります。これら個別規定はその名称のいかんに関わらず、本規約の一部を構成するものとします。</li>
          <li>本規約の規定が前条の個別規定の規定と矛盾する場合には、個別規定において特段の定めなき限り、個別規定の規定が優先されるものとします。</li>
        </ol>

        <h2>第2条（利用登録）</h2>
        <ol>
          <li>本サービスにおいては、登録希望者が本規約に同意の上、Googleアカウントによる認証を通じて利用登録を行うものとします。</li>
          <li>当社は、利用登録の申請者に以下の事由があると判断した場合、利用登録の申請を承認しないことがあり、その理由については一切の開示義務を負わないものとします。
            <ol>
              <li>本規約に違反したことがある者からの申請である場合</li>
              <li>その他、当社が利用登録を相当でないと判断した場合</li>
            </ol>
          </li>
        </ol>

        <h2>第3条（アカウントの管理）</h2>
        <ol>
          <li>ユーザーは、自己の責任において、本サービスのアカウント（Googleアカウント連携を含む）を適切に管理するものとします。</li>
          <li>ユーザーのアカウントが第三者によって使用されたことによって生じた損害は、当社に故意又は重大な過失がある場合を除き、当社は一切の責任を負わないものとします。</li>
        </ol>

        <h2>第4条（データの保存と管理）</h2>
        <ol>
          <li>本サービスで作成・管理されるデータは、ユーザー自身のGoogle Driveに保存されます。当社はユーザーのデータを当社のサーバーに保存しません。</li>
          <li>ユーザーは、Google DriveおよびGoogle APIの利用規約にも従うものとします。</li>
          <li>ユーザーが設定するGemini APIキーは、ユーザー自身の責任で管理するものとします。</li>
        </ol>

        <h2>第5条（禁止事項）</h2>
        <p>ユーザーは、本サービスの利用にあたり、以下の行為をしてはなりません。</p>
        <ol>
          <li>法令または公序良俗に違反する行為</li>
          <li>犯罪行為に関連する行為</li>
          <li>当社、本サービスの他のユーザー、または第三者のサーバーまたはネットワークの機能を破壊したり、妨害したりする行為</li>
          <li>当社のサービスの運営を妨害するおそれのある行為</li>
          <li>不正アクセスをし、またはこれを試みる行為</li>
          <li>他のユーザーに成りすます行為</li>
          <li>当社、本サービスの他のユーザーまたは第三者の知的財産権、プライバシー、名誉その他の権利または利益を侵害する行為</li>
        </ol>

        <h2>第6条（本サービスの提供の停止等）</h2>
        <ol>
          <li>当社は、以下のいずれかの事由があると判断した場合、ユーザーに事前に通知することなく本サービスの全部または一部の提供を停止または中断することができるものとします。
            <ol>
              <li>本サービスにかかるコンピュータシステムの保守点検または更新を行う場合</li>
              <li>地震、落雷、火災、停電または天災などの不可抗力により、本サービスの提供が困難となった場合</li>
              <li>コンピュータまたは通信回線等が事故により停止した場合</li>
              <li>その他、当社が本サービスの提供が困難と判断した場合</li>
            </ol>
          </li>
          <li>当社は、本サービスの提供の停止または中断により、ユーザーまたは第三者が被ったいかなる不利益または損害についても、一切の責任を負わないものとします。</li>
        </ol>

        <h2>第7条（著作権）</h2>
        <ol>
          <li>ユーザーは、自ら著作権等の必要な知的財産権を有するか、または必要な権利者の許諾を得た文章、画像や映像等の情報に関してのみ、本サービスを利用し、投稿ないしアップロードすることができるものとします。</li>
          <li>ユーザーが本サービスを利用して作成・保存した文章、画像、映像等の著作権については、当該ユーザーその他既存の権利者に留保されるものとします。</li>
        </ol>

        <h2>第8条（利用制限および登録抹消）</h2>
        <ol>
          <li>当社は、ユーザーが以下のいずれかに該当する場合には、事前の通知なく、ユーザーに対して、本サービスの全部もしくは一部の利用を制限し、またはユーザーとしての登録を抹消することができるものとします。
            <ol>
              <li>本規約のいずれかの条項に違反した場合</li>
              <li>その他、当社が本サービスの利用を適当でないと判断した場合</li>
            </ol>
          </li>
          <li>当社は、本条に基づき当社が行った行為によりユーザーに生じた損害について、一切の責任を負いません。</li>
        </ol>

        <h2>第9条（保証の否認および免責事項）</h2>
        <ol>
          <li>当社は、本サービスに事実上または法律上の瑕疵（安全性、信頼性、正確性、完全性、有効性、特定の目的への適合性、セキュリティなどに関する欠陥、エラーやバグ、権利侵害などを含みます）がないことを明示的にも黙示的にも保証しておりません。</li>
          <li>当社は、本サービスに起因してユーザーに生じたあらゆる損害について、当社の故意又は重過失による場合を除き、一切の責任を負いません。</li>
          <li>本サービスはGoogle Gemini APIを利用しており、AIによる生成結果の正確性について当社は保証しません。</li>
        </ol>

        <h2>第10条（サービス内容の変更等）</h2>
        <p>当社は、ユーザーへの事前の告知をもって、本サービスの内容を変更、追加または廃止することがあり、ユーザーはこれを承諾するものとします。</p>

        <h2>第11条（利用規約の変更）</h2>
        <ol>
          <li>当社は以下の場合には、ユーザーの個別の同意を要せず、本規約を変更することができるものとします。
            <ol>
              <li>本規約の変更がユーザーの一般の利益に適合するとき。</li>
              <li>本規約の変更が本サービス利用契約の目的に反せず、かつ、変更の必要性、変更後の内容の相当性その他の変更に係る事情に照らして合理的なものであるとき。</li>
            </ol>
          </li>
          <li>当社はユーザーに対し、前項による本規約の変更にあたり、事前に、本規約を変更する旨及び変更後の本規約の内容並びにその効力発生時期を通知します。</li>
        </ol>

        <p className="mt-10 text-sm text-gray-400 dark:text-gray-500">最終更新日：2025年3月16日</p>
      </div>
    </>
  );
}

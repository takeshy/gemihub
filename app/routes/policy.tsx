import { ArrowLeft } from "lucide-react";
import { useLocation } from "react-router";
import type { Language } from "~/types/settings";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

export default function Policy() {
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
          <LanguageSwitcher lang={lang} basePath="/policy" />
        </div>

        {lang === "ja" ? <PolicyJa /> : <PolicyEn />}
      </main>
    </div>
  );
}

function PolicyEn() {
  return (
    <>
      <h1 className="mb-8 text-3xl font-bold text-gray-900 dark:text-gray-50">Privacy Policy</h1>
      <div className="prose prose-gray max-w-none dark:prose-invert text-gray-700 dark:text-gray-300 [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:dark:text-gray-100 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_p]:mb-4 [&_p]:leading-relaxed">
        <p>
          <a href="https://takeshy.work" className="text-blue-600 hover:underline dark:text-blue-400">takeshy.work</a> (hereinafter referred to as &ldquo;the Company&rdquo;) recognizes the importance of protecting personal information in Gemini Hub (hereinafter referred to as &ldquo;the Service&rdquo;) and strives to handle and protect personal information appropriately.
        </p>

        <h2>1. Definition of Personal Information</h2>
        <p>
          In this Privacy Policy, personal information refers to information about a living individual that can identify a specific individual through descriptions such as name, email address, or other descriptions contained in the information.
        </p>

        <h2>2. Methods of Collecting Personal Information</h2>
        <p>The Company collects personal information through the following methods:</p>
        <ul>
          <li>Authentication information obtained through Google account integration (name, email address, profile picture)</li>
          <li>Information automatically collected during use of the Service (access logs, etc.)</li>
        </ul>

        <h2>3. Data Storage Location</h2>
        <p>
          All data created and managed through the Service (chat history, workflows, settings, etc.) is stored in the User&apos;s own Google Drive. User content data is not permanently stored on the Company&apos;s servers. Session information is temporarily managed through cookies.
        </p>

        <h2>4. Purpose of Use of Personal Information</h2>
        <p>The Company uses collected personal information for the following purposes:</p>
        <ul>
          <li>Provision and operation of the Service</li>
          <li>Integration with Google Drive and Google Gemini API</li>
          <li>User authentication and session management</li>
          <li>Service improvement and development of new features</li>
        </ul>

        <h2>5. Disclosure of Personal Information to Third Parties</h2>
        <p>The Company will not disclose personal information to third parties except in the following cases:</p>
        <ul>
          <li>When the User has given consent</li>
          <li>When required by law</li>
          <li>When necessary to protect a person&apos;s life, body, or property</li>
          <li>Information sharing within the scope necessary for using Google API services (Google Drive, Gemini API, etc.)</li>
        </ul>

        <h2>6. Security of Personal Information</h2>
        <p>
          The Company implements appropriate security measures to prevent leakage, loss, or damage of personal information. The Service also offers optional encryption features (RSA+AES) for encrypting chat history and workflow history.
        </p>

        <h2>7. Use of Cookies</h2>
        <p>
          The Service uses cookies for user authentication and session management. If you refuse cookies, you may not be able to use the Service.
        </p>

        <h2>8. User Rights</h2>
        <p>
          Users can directly access and delete their data from Google Drive. To delete your Service account, you can disconnect the Google account integration.
        </p>

        <h2>9. Changes to Privacy Policy</h2>
        <p>
          The Company may change this Privacy Policy as necessary. The changed Privacy Policy shall take effect upon being posted on the Service.
        </p>

        <p className="mt-10 text-sm text-gray-400 dark:text-gray-500">Last updated: March 16, 2025</p>
      </div>
    </>
  );
}

function PolicyJa() {
  return (
    <>
      <h1 className="mb-8 text-3xl font-bold text-gray-900 dark:text-gray-50">プライバシーポリシー</h1>
      <div className="prose prose-gray max-w-none dark:prose-invert text-gray-700 dark:text-gray-300 [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:dark:text-gray-100 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_p]:mb-4 [&_p]:leading-relaxed">
        <p>
          株式会社<a href="https://takeshy.work" className="text-blue-600 hover:underline dark:text-blue-400">takeshy.work</a>（以下、「当社」といいます。）は、Gemini Hub（以下、「本サービス」といいます。）におけるお客様の個人情報保護の重要性を認識し、適切な個人情報の取り扱いと保護に努めます。
        </p>

        <h2>1. 個人情報の定義</h2>
        <p>
          本プライバシーポリシーにおいて、個人情報とは、生存する個人に関する情報であって、当該情報に含まれる氏名、メールアドレスその他の記述等により特定の個人を識別することができるものを指します。
        </p>

        <h2>2. 個人情報の収集方法</h2>
        <p>当社は、以下の方法により個人情報を取得します：</p>
        <ul>
          <li>Googleアカウント連携による認証情報（氏名、メールアドレス、プロフィール画像）</li>
          <li>本サービスの利用時に自動的に収集される情報（アクセスログ等）</li>
        </ul>

        <h2>3. データの保存場所</h2>
        <p>
          本サービスで作成・管理されるデータ（チャット履歴、ワークフロー、設定情報等）は、すべてユーザー自身のGoogle Driveに保存されます。当社のサーバーにユーザーのコンテンツデータが永続的に保存されることはありません。セッション情報はCookieを通じて一時的に管理されます。
        </p>

        <h2>4. 個人情報の利用目的</h2>
        <p>当社は、取得した個人情報を以下の目的のために利用します：</p>
        <ul>
          <li>本サービスの提供・運営</li>
          <li>Google DriveおよびGoogle Gemini APIとの連携</li>
          <li>ユーザー認証とセッション管理</li>
          <li>サービスの改善と新機能の開発</li>
        </ul>

        <h2>5. 個人情報の第三者提供</h2>
        <p>当社は、以下の場合を除き、お客様の個人情報を第三者へ提供することはありません：</p>
        <ul>
          <li>お客様の同意がある場合</li>
          <li>法令に基づく場合</li>
          <li>人の生命、身体または財産の保護のために必要がある場合</li>
          <li>Google APIサービスの利用に必要な範囲での情報連携（Google Drive、Gemini API等）</li>
        </ul>

        <h2>6. 個人情報の安全管理</h2>
        <p>
          当社は、個人情報の漏洩、滅失、き損を防止するため、適切なセキュリティ対策を実施し、個人情報の安全管理に努めます。本サービスでは、オプションの暗号化機能（RSA+AES）によるチャット履歴・ワークフロー履歴の暗号化もご利用いただけます。
        </p>

        <h2>7. Cookieの使用について</h2>
        <p>
          本サービスでは、ユーザー認証とセッション管理のためにCookieを使用します。Cookieを拒否した場合、本サービスをご利用いただけない場合があります。
        </p>

        <h2>8. お客様の権利</h2>
        <p>
          お客様は、ご自身のデータについて、Google Driveから直接アクセス・削除が可能です。本サービスのアカウント削除をご希望の場合は、Googleアカウントの連携を解除することで対応できます。
        </p>

        <h2>9. プライバシーポリシーの変更</h2>
        <p>
          当社は、必要に応じて本プライバシーポリシーを変更することがあります。変更後のプライバシーポリシーは、本サービス上に掲載された時点から効力を生じるものとします。
        </p>

        <p className="mt-10 text-sm text-gray-400 dark:text-gray-500">最終更新日：2025年3月16日</p>
      </div>
    </>
  );
}

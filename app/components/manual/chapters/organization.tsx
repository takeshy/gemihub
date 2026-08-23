import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function OrganizationChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <OrganizationJa />;
  return <OrganizationEn />;
}

function OrganizationEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Organizations</h1>
      <div className={prose}>
        <p>
          On the <strong>Business</strong> plan, subscribing provisions an <strong>organization</strong>: a workspace whose files everyone on the team opens, edits, and syncs together. Billing is per organization, so adding members costs nothing extra. One account can purchase and switch between multiple Business organizations.
        </p>
        <p>
          Nothing about the free experience goes away. Your own Drive is still there — the two live side by side, and you switch between them at any time.
        </p>

        <h2>Two Workspaces</h2>
        <ul>
          <li><strong>My Drive</strong> — the default for everyone. Files live in your Google Drive, and AI runs on your own Gemini API key in the browser.</li>
          <li><strong>Organization</strong> — files live in GemiHub&apos;s managed cloud storage, and AI runs on the organization&apos;s Vertex AI, so members need no API key of their own.</li>
        </ul>
        <p>
          Switch between <strong>My Drive</strong> and each organization with the single workspace selector in the IDE header. File tree, chat, sync, and RAG follow that selection.
        </p>
        <img src="/images/organization_general_en.png" alt="Organization project selected in the workspace header" className="w-full" loading="lazy" />

        <h2>The My Drive Shelf</h2>
        <p>
          While an organization is selected, its file tree is shown and your personal Drive sits above it as the <strong>My Drive</strong> shelf. Drag a file in either direction to copy it between the two.
        </p>
        <p>
          Click a file in the shelf to preview it in a separate read-only window without leaving the organization. The IDE header and all Pull/Push operations remain scoped to the selected organization.
        </p>

        <h2>Sync in an Organization</h2>
        <p>
          Push and pull work exactly as they do on your own Drive, including the conflict dialog and diff preview. The difference is underneath: every write carries the revision it was based on, so if a teammate saved first, your push is rejected with a conflict instead of quietly overwriting their work.
        </p>
        <img src="/images/organization_sync_en.png" alt="Sync settings inside an organization project" className="w-full" loading="lazy" />

        <h2>Members &amp; Roles</h2>
        <p>
          Administrators manage people in <strong>Settings &gt; Organization &gt; Members</strong>. Adding someone by email takes effect immediately — they sign in with their Google account and receive a notification email sent from the administrator&apos;s own Gmail.
        </p>
        <img src="/images/organization_settings_en.png" alt="Organization member management settings" className="w-full" loading="lazy" />
        <ul>
          <li><strong>Organization roles</strong> — <code>owner</code>, <code>admin</code>, <code>member</code>. Owners and admins manage members, budgets, and storage.</li>
        </ul>
        <p>
          Members with no plan of their own are entitled through the organization&apos;s subscription, so they do not need to subscribe individually.
        </p>

        <h2>Vertex AI &amp; the Monthly Budget</h2>
        <p>
          Inside an organization, chat, RAG, and workflow AI run on the organization&apos;s Vertex AI — no per-user Gemini API key. Spending is tracked per organization and per member in <strong>Settings &gt; Organization &gt; Vertex AI</strong>:
        </p>
        <ul>
          <li><strong>Included budget</strong> — $30 per billing period, following the subscription cycle rather than the calendar month.</li>
          <li><strong>Top-ups</strong> — buy more in ¥1,500 ($9 credited) units when a period runs short. A top-up stays usable until the end of the following period.</li>
          <li><strong>Per-member limits</strong> — set a default monthly cap for everyone, and override it for individuals. Reaching a cap stops AI calls for that scope, not for the whole organization.</li>
          <li><strong>Advanced</strong> — owners can point the organization at their own Google Cloud project and Vertex AI location.</li>
        </ul>

        <h2>Storage</h2>
        <p>
          Each organization includes <strong>100 GB</strong> of shared storage, expandable once by a <strong>500 GB</strong> add-on (¥5,000 / $30 per month, cancellable from the Stripe portal) for a 600 GB ceiling.
        </p>
        <p>
          When storage is full, sync pauses. Deleting still works, but a trashed file keeps using space — empty the trash to actually free it.
        </p>

        <h2>Search &amp; RAG on Shared Files</h2>
        <p>
          Each organization has its own vector search over its files, so the AI answers from the team&apos;s documents.
        </p>

        <h2>Dashboards &amp; Workflows in an Organization</h2>
        <p>
          Dashboards and workflows use the same editors as My Drive. The workspace bar makes the active organization explicit; saved files and AI execution stay scoped to that organization.
        </p>
        <img src="/images/organization_dashboard_en.png" alt="Dashboard in an organization project" className="w-full" loading="lazy" />
        <img src="/images/organization_workflow_en.png" alt="Workflow editor in an organization project" className="w-full" loading="lazy" />

        <h2>Self-Hosting</h2>
        <p>
          The whole organization surface depends on Firestore and Cloud Storage. A self-hosted instance without them simply stays on the Drive workspace — the switcher and the Organization tab never appear.
        </p>
      </div>
    </>
  );
}

function OrganizationJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">組織</h1>
      <div className={prose}>
        <p>
          <strong>Business</strong>を契約すると、チーム全員が同じファイルを開き、編集し、同期できる<strong>組織</strong>が作成されます。課金は組織単位で、1つのアカウントから複数のBusiness組織を購入して切り替えられます。
        </p>
        <p>
          無料プランの使い勝手が失われることはありません。自分のDriveはそのまま残り、2つのワークスペースはいつでも切り替えられます。
        </p>

        <h2>2つのワークスペース</h2>
        <ul>
          <li><strong>My Drive</strong> — 全ユーザーの既定。ファイルは自分のGoogle Driveに保存され、AIは自分のGemini APIキーでブラウザ上から実行されます。</li>
          <li><strong>組織</strong> — ファイルはGemiHubのマネージドクラウドストレージに保存され、AIは組織のVertex AIで動作するため、メンバー個人のAPIキーは不要です。</li>
        </ul>
        <p>
          IDEヘッダーの1つのワークスペースセレクタで、<strong>My Drive</strong>と各組織を切り替えます。ファイルツリー・チャット・同期・RAGは選択先に連動します。
        </p>
        <img src="/images/organization_general.png" alt="ワークスペースヘッダーで組織プロジェクトを選択した画面" className="w-full" loading="lazy" />

        <h2>My Driveシェルフ</h2>
        <p>
          組織を選択している間、組織のファイルツリーの上に<strong>My Drive</strong>シェルフとして自分のDriveが並びます。ドラッグでどちらの方向にもファイルをコピーできます。
        </p>
        <p>
          シェルフのファイルをクリックすると、組織を選択したまま、読み取り専用の別ウィンドウで内容を確認できます。Pull／Pushの対象は選択中の組織です。
        </p>

        <h2>組織での同期</h2>
        <p>
          Push / Pull は自分のDriveと同じ操作感で、コンフリクトダイアログや差分プレビューもそのまま使えます。違うのは内部の仕組みで、書き込みには基となったリビジョンが付きます。先に同僚が保存していた場合、Pushは黙って上書きせずコンフリクトとして拒否されます。
        </p>
        <img src="/images/organization_sync.png" alt="組織プロジェクト内の同期設定" className="w-full" loading="lazy" />

        <h2>メンバーと権限</h2>
        <p>
          管理者は<strong>設定 &gt; 組織 &gt; メンバー</strong>で人を管理します。メールアドレスで追加するとその場で有効になり、本人はGoogleアカウントでサインインします。通知メールは管理者自身のGmailから送信されます。
        </p>
        <img src="/images/organization_settings.png" alt="組織メンバーの管理設定" className="w-full" loading="lazy" />
        <ul>
          <li><strong>組織ロール</strong> — <code>owner</code> / <code>admin</code> / <code>member</code>。ownerとadminがメンバー・予算・ストレージを管理します。</li>
        </ul>
        <p>
          自分では有料プランを契約していないメンバーも、組織のサブスクリプションで権利が付与されるため、個別契約は不要です。
        </p>

        <h2>Vertex AIと月間予算</h2>
        <p>
          組織内のチャット・RAG・ワークフローのAIは組織のVertex AIで動作し、ユーザーごとのGemini APIキーは不要です。
        </p>
        <ul>
          <li><strong>付属の利用枠</strong> — 請求期間ごとに$30。暦月ではなくサブスクリプションの請求サイクルに沿います。</li>
          <li><strong>追加購入</strong> — 足りなくなったら¥1,500（$9分クレジット）単位で追加できます。購入した枠は次の請求期間の終わりまで利用可能です。</li>
          <li><strong>メンバーごとの上限</strong> — 全員の既定上限を設定し、個別に上書きできます。上限に達してもその範囲のAI呼び出しが止まるだけで、組織全体は停止しません。</li>
          <li><strong>詳細設定</strong> — ownerは組織独自のGoogle CloudプロジェクトとVertex AIロケーションを指定できます。</li>
        </ul>

        <h2>ストレージ</h2>
        <p>
          組織ごとに<strong>100 GB</strong>の共有ストレージが含まれます。<strong>500 GB</strong>のアドオン（¥5,000／$30 月額）を1つ追加でき、上限は600 GBです。
        </p>
        <p>
          ストレージが満杯になると同期は停止します。削除自体は可能ですが、ゴミ箱のファイルは容量を消費し続けるため、完全に削除して初めて空きが戻ります。
        </p>

        <h2>共有ファイルの検索とRAG</h2>
        <p>
          組織ごとに専用のベクトル検索があり、AIはチームの資料をもとに回答します。
        </p>

        <h2>組織内のDashboardとWorkflow</h2>
        <p>
          DashboardとWorkflowはMy Driveと同じエディターを使用します。ワークスペースバーで現在の組織を確認でき、保存先とAI実行はその組織内に限定されます。
        </p>
        <img src="/images/organization_dashboard.png" alt="組織プロジェクト内のDashboard" className="w-full" loading="lazy" />
        <img src="/images/organization_workflow.png" alt="組織プロジェクト内のWorkflowエディター" className="w-full" loading="lazy" />

        <h2>セルフホストの場合</h2>
        <p>
          組織関連の機能はFirestoreとCloud Storageに依存します。これらのないセルフホスト環境では単にDriveワークスペースのみとなり、ワークスペースセレクタも組織タブも表示されません。
        </p>
      </div>
    </>
  );
}

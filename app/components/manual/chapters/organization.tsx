import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function OrganizationChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <OrganizationJa />;
  return <OrganizationEn />;
}

function OrganizationEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Organizations &amp; Shared Projects</h1>
      <div className={prose}>
        <p>
          On the <strong>Business</strong> plan, GemiHub is not just your own Drive any more. Subscribing provisions an <strong>organization</strong> with one shared <strong>project</strong>: a workspace whose files everyone on the team opens, edits, and syncs together. Billing is per organization, so adding members costs nothing extra.
        </p>
        <p>
          Nothing about the free experience goes away. Your own Drive is still there — the two live side by side, and you switch between them at any time.
        </p>

        <h2>Two Workspaces</h2>
        <ul>
          <li><strong>My Drive</strong> — the default for everyone. Files live in your Google Drive, and AI runs on your own Gemini API key in the browser.</li>
          <li><strong>Organization project</strong> — available while you belong to an organization. Files live in GemiHub&apos;s managed cloud storage under the project, and AI runs on the organization&apos;s Vertex AI, so members need no API key of their own.</li>
        </ul>
        <p>
          Switch with the workspace selector in the IDE header. It appears only if you belong to at least one organization; choosing <strong>My Drive</strong> deselects the project and returns everything — file tree, chat, sync, RAG — to your own Drive.
        </p>
        <img src="/images/organization_general_en.png" alt="Organization project selected in the workspace header" className="w-full" loading="lazy" />

        <h2>The My Drive Shelf</h2>
        <p>
          While a project is selected, the file tree shows the project and your personal Drive sits above it as the <strong>My Drive</strong> shelf. Drag a file in either direction to copy it between the two. A drag always <em>copies</em> — the source keeps its file, so dragging can never remove something from under the team.
        </p>

        <h2>Sync in a Project</h2>
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
          <li><strong>Organization roles</strong> — <code>owner</code>, <code>admin</code>, <code>member</code>. Owners and admins manage members, budgets, storage, and projects.</li>
          <li><strong>Project roles</strong> — <code>admin</code>, <code>editor</code>, <code>viewer</code>, set per project.</li>
          <li><strong>External collaborators</strong> — someone outside the organization can be added to a single project. They are marked <strong>External</strong> in the member list and see nothing else in the organization.</li>
        </ul>
        <p>
          Members with no plan of their own are entitled through the organization&apos;s subscription, so they do not need to subscribe individually.
        </p>

        <h2>Vertex AI &amp; the Monthly Budget</h2>
        <p>
          Inside a project, chat, RAG, and workflow AI run on the organization&apos;s Vertex AI — no per-user Gemini API key. Spending is tracked per organization and per member in <strong>Settings &gt; Organization &gt; Vertex AI</strong>:
        </p>
        <ul>
          <li><strong>Included budget</strong> — $30 per billing period, following the subscription cycle rather than the calendar month.</li>
          <li><strong>Top-ups</strong> — buy more in $30 units (¥4,500) when a period runs short. A top-up stays usable until the end of the following period.</li>
          <li><strong>Per-member limits</strong> — set a default monthly cap for everyone, and override it for individuals. Reaching a cap stops AI calls for that scope, not for the whole organization.</li>
          <li><strong>Advanced</strong> — owners can point the organization at their own Google Cloud project and Vertex AI location.</li>
        </ul>

        <h2>Storage</h2>
        <p>
          Each organization includes <strong>100 GB</strong> of shared project storage, expandable once by a <strong>500 GB</strong> add-on (¥5,000 / $30 per month, cancellable from the Stripe portal) for a 600 GB ceiling. Usage and remaining space are shown in <strong>Settings &gt; Organization &gt; Storage</strong>.
        </p>
        <p>
          When storage is full, sync pauses. Deleting still works, but a trashed file keeps using space — empty the trash to actually free it.
        </p>

        <h2>Search &amp; RAG on Shared Files</h2>
        <p>
          A project has its own vector search over its files, so the AI answers from the team&apos;s documents. RAG sync is run from the RAG settings tab exactly as on Drive; only the index behind it differs.
        </p>

        <h2>Projects</h2>
        <p>
          The default project is selected automatically, so most teams never need more. If you want to split work into separate workspaces, open <strong>Advanced: project management</strong> in the Organization tab to create a project, add its members, and switch to it.
        </p>

        <h2>Dashboards &amp; Workflows in a Project</h2>
        <p>
          Dashboards and workflows use the same editors as My Drive. The workspace bar makes the active organization and project explicit; saved files and AI execution stay scoped to that project.
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
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">組織と共有プロジェクト</h1>
      <div className={prose}>
        <p>
          <strong>Business</strong>プランでは、GemiHubは自分のDriveだけのものではなくなります。契約すると<strong>組織</strong>と、共有<strong>プロジェクト</strong>が1つ自動的に作成されます。プロジェクトはチーム全員が同じファイルを開き、編集し、同期するワークスペースです。課金は組織単位なので、メンバーを増やしても追加費用はかかりません。
        </p>
        <p>
          無料プランの使い勝手が失われることはありません。自分のDriveはそのまま残り、2つのワークスペースはいつでも切り替えられます。
        </p>

        <h2>2つのワークスペース</h2>
        <ul>
          <li><strong>My Drive</strong> — 全ユーザーの既定。ファイルは自分のGoogle Driveに保存され、AIは自分のGemini APIキーでブラウザ上から実行されます。</li>
          <li><strong>組織プロジェクト</strong> — 組織に所属している間だけ利用可能。ファイルはGemiHubのマネージドクラウドストレージのプロジェクト配下に保存され、AIは組織のVertex AIで動作するため、メンバー個人のAPIキーは不要です。</li>
        </ul>
        <p>
          切り替えはIDEヘッダーのワークスペースセレクタから。組織に所属している場合のみ表示され、<strong>My Drive</strong>を選ぶとプロジェクトの選択が解除され、ファイルツリー・チャット・同期・RAGのすべてが自分のDriveに戻ります。
        </p>
        <img src="/images/organization_general.png" alt="ワークスペースヘッダーで組織プロジェクトを選択した画面" className="w-full" loading="lazy" />

        <h2>My Driveシェルフ</h2>
        <p>
          プロジェクトを選択している間、ファイルツリーにはプロジェクトが表示され、その上に<strong>My Drive</strong>シェルフとして自分のDriveが並びます。ドラッグでどちらの方向にもファイルをコピーできます。ドラッグは常に<em>コピー</em>で、元のファイルは残るため、チームのファイルが消えることはありません。
        </p>

        <h2>プロジェクトでの同期</h2>
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
          <li><strong>組織ロール</strong> — <code>owner</code> / <code>admin</code> / <code>member</code>。ownerとadminがメンバー・予算・ストレージ・プロジェクトを管理します。</li>
          <li><strong>プロジェクトロール</strong> — <code>admin</code> / <code>editor</code> / <code>viewer</code>をプロジェクトごとに設定します。</li>
          <li><strong>外部コラボレーター</strong> — 組織外の人を特定のプロジェクトだけに追加できます。メンバー一覧では<strong>外部</strong>と表示され、組織の他の情報は見えません。</li>
        </ul>
        <p>
          自分では有料プランを契約していないメンバーも、組織のサブスクリプションで権利が付与されるため、個別契約は不要です。
        </p>

        <h2>Vertex AIと月間予算</h2>
        <p>
          プロジェクト内のチャット・RAG・ワークフローのAIは組織のVertex AIで動作し、ユーザーごとのGemini APIキーは不要です。利用額は組織単位・メンバー単位で<strong>設定 &gt; 組織 &gt; Vertex AI</strong>から確認できます。
        </p>
        <ul>
          <li><strong>付属の利用枠</strong> — 請求期間ごとに$30。暦月ではなくサブスクリプションの請求サイクルに沿います。</li>
          <li><strong>追加購入</strong> — 足りなくなったら$30単位（¥4,500）で追加できます。購入した枠は次の請求期間の終わりまで利用可能です。</li>
          <li><strong>メンバーごとの上限</strong> — 全員の既定上限を設定し、個別に上書きできます。上限に達してもその範囲のAI呼び出しが止まるだけで、組織全体は停止しません。</li>
          <li><strong>詳細設定</strong> — ownerは組織独自のGoogle CloudプロジェクトとVertex AIロケーションを指定できます。</li>
        </ul>

        <h2>ストレージ</h2>
        <p>
          組織ごとに<strong>100 GB</strong>の共有プロジェクトストレージが含まれます。<strong>500 GB</strong>のアドオン（¥5,000／$30 月額、Stripeポータルからいつでも解約可）を1つ追加でき、上限は600 GBです。使用量と残量は<strong>設定 &gt; 組織 &gt; ストレージ</strong>で確認できます。
        </p>
        <p>
          ストレージが満杯になると同期は停止します。削除自体は可能ですが、ゴミ箱のファイルは容量を消費し続けるため、完全に削除して初めて空きが戻ります。
        </p>

        <h2>共有ファイルの検索とRAG</h2>
        <p>
          プロジェクトには専用のベクトル検索があり、AIはチームの資料をもとに回答します。RAG同期の操作はDriveのときと同じくRAG設定タブから行い、違うのは背後のインデックスだけです。
        </p>

        <h2>プロジェクト</h2>
        <p>
          既定のプロジェクトは自動的に選択されるため、通常は追加不要です。用途ごとにワークスペースを分けたい場合は、組織タブの<strong>詳細: プロジェクト管理</strong>を開いて、プロジェクトの作成・メンバー追加・切り替えができます。
        </p>

        <h2>プロジェクト内のDashboardとWorkflow</h2>
        <p>
          DashboardとWorkflowはMy Driveと同じエディターを使用します。ワークスペースバーで現在の組織とプロジェクトを確認でき、保存先とAI実行はそのプロジェクト内に限定されます。
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

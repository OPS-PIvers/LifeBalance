import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { CONSENT_VERSION } from '@/utils/legal';

/**
 * Public Privacy Policy page (Plan 011).
 *
 * DRAFT copy pending legal review. Every fact a human must own is marked with a
 * bracketed [PLACEHOLDER: …] token — do not replace these with invented values.
 */
const PrivacyPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 py-10 px-4">
      <div className="w-full max-w-2xl mx-auto">
        <div className="bg-white dark:bg-brand-800 rounded-2xl shadow-2xl p-8 space-y-6">
          {/* Back link */}
          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200 font-medium text-sm"
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </Link>

          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl mb-4">
              <ShieldCheck className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-brand-800 dark:text-brand-100 mb-1">
              Privacy Policy
            </h1>
            <p className="text-brand-500 dark:text-brand-400 text-sm">
              How LifeBalance handles your information
            </p>
          </div>

          {/* DRAFT banner */}
          <div
            role="alert"
            className="rounded-card border border-warm-200 dark:border-warm-700 bg-warm-50 dark:bg-warm-900/40 p-4 text-sm text-warm-800 dark:text-warm-200"
          >
            <p className="font-semibold">DRAFT — pending legal review. Not yet legally binding.</p>
            <p className="mt-1">Effective date: [PLACEHOLDER: effective date]</p>
            <p className="mt-1">Policy version: {CONSENT_VERSION}</p>
          </div>

          {/* Body */}
          <div className="space-y-6 text-sm leading-relaxed text-brand-700 dark:text-brand-300">
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                1. Who we are
              </h2>
              <p>
                LifeBalance is a household management app for tracking finances, building habits,
                planning meals, and managing shared lists. This Privacy Policy explains what data we
                collect, how we use it, and the choices you have. It is provided by{' '}
                [PLACEHOLDER: legal entity name] (&ldquo;we&rdquo;, &ldquo;us&rdquo;). You can reach
                us at [PLACEHOLDER: contact email] or by mail at [PLACEHOLDER: mailing address].
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                2. Information we collect
              </h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-medium">Google account profile.</span> When you sign in with
                  Google, we receive your name, email address, and profile photo from your Google
                  account.
                </li>
                <li>
                  <span className="font-medium">Financial figures you enter.</span> Account balances,
                  budget amounts, transactions, bills, and other money figures you type into the app.
                </li>
                <li>
                  <span className="font-medium">Bank account data, if you choose to connect one.</span>{' '}
                  You can optionally connect a bank account through our provider Plaid so that
                  transactions and balances import automatically. This is off by default. If you use
                  it, we receive and store the transactions and balances Plaid sends us. The
                  credential that grants access to your bank is held on our servers and is never sent
                  to the app. You can disconnect at any time from Settings, which revokes the
                  connection at Plaid. See &ldquo;How your data is stored &amp; processed&rdquo; below.
                </li>
                <li>
                  <span className="font-medium">Habits and gamification data.</span> The habits you
                  create, your completions, streaks, points, and rewards.
                </li>
                <li>
                  <span className="font-medium">Household membership.</span> Which household you
                  belong to, your role, and the other members of your household (households are shared
                  by invite code).
                </li>
                <li>
                  <span className="font-medium">Meals, lists, and to-dos.</span> Recipes, meal plans,
                  shopping lists, and shared household to-dos you add.
                </li>
                <li>
                  <span className="font-medium">Images you upload for AI features.</span> Photos of
                  receipts or bank statements you choose to scan (see &ldquo;AI features &amp; your
                  data&rdquo; below).
                </li>
                <li>
                  <span className="font-medium">Device &amp; notification data.</span> If you enable
                  push notifications, we store a device messaging token so we can send habit
                  reminders, budget alerts, and bill reminders.
                </li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                3. How we use your information
              </h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>To provide the app&apos;s core features and sync your data across your devices.</li>
                <li>To share household data among the members of your household.</li>
                <li>To calculate figures like Safe-to-Spend, points, streaks, and insights.</li>
                <li>To send the notifications you have opted into.</li>
                <li>To power the optional AI features you choose to use.</li>
                <li>To maintain security, prevent abuse, and debug problems.</li>
              </ul>
              <p>
                We do not sell your personal information, and we do not use your financial or habit
                data for advertising.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                4. AI features &amp; your data
              </h2>
              <p>
                Several optional features send data to <span className="font-medium">Google
                Gemini</span> to produce a result. These features run only when you actively trigger
                them. For each, the data sent is:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-medium">Receipt scanning</span> — the receipt{' '}
                  <em>photo</em> you upload, to read the merchant, amount, date, and category.
                </li>
                <li>
                  <span className="font-medium">Bank-statement parsing</span> — the statement{' '}
                  <em>photo/screenshot</em> you upload, to extract a list of transactions (dates,
                  descriptions, amounts).
                </li>
                <li>
                  <span className="font-medium">Grocery-receipt parsing</span> — the grocery receipt{' '}
                  <em>photo</em> you upload, to extract item names, quantities, and categories.
                </li>
                <li>
                  <span className="font-medium">Meal suggestions</span> — your stated preferences
                  (such as budget and time constraints) plus titles of your past meals.
                </li>
                <li>
                  <span className="font-medium">Dashboard insights</span> — your recent transactions
                  (including amounts, categories, and dates, and optionally merchant names) together
                  with your habit titles and completion statistics.
                </li>
                <li>
                  <span className="font-medium">Habit analysis</span> — your habit statistics (titles,
                  types, counts, streaks, and recent completion dates).
                </li>
              </ul>
              <p>
                AI requests are sent through LifeBalance&apos;s server-side proxy rather than directly
                from your browser. LifeBalance does not retain the images or data you submit for these
                features beyond what is needed to complete the request. Once Google processes a
                request, Google&apos;s own terms and privacy policy apply to that processing; see the{' '}
                <a
                  href="https://ai.google.dev/gemini-api/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-700 dark:text-accent-300 underline underline-offset-2 hover:text-accent-800 dark:hover:text-accent-200"
                >
                  Gemini API Additional Terms of Service
                </a>{' '}
                and the{' '}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-700 dark:text-accent-300 underline underline-offset-2 hover:text-accent-800 dark:hover:text-accent-200"
                >
                  Google Privacy Policy
                </a>
                . If you prefer not to share this data, simply do not use the AI features.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                5. How your data is stored &amp; processed
              </h2>
              <p>
                Your data is stored and synced using Google Firebase and Google Cloud (Firestore,
                Firebase Authentication, and Firebase Cloud Messaging), which act as our data
                processors. Data may be processed on Google&apos;s infrastructure in accordance with
                Google&apos;s security practices. Our AI features are processed by Google Gemini as
                described above.
              </p>
              <p>
                If you connect a bank account, that connection is provided by{' '}
                <span className="font-medium">Plaid Inc.</span>, which acts as our data processor for
                bank data. Plaid communicates with your bank on our behalf and sends us your
                transactions and balances. The access credential Plaid issues is stored server-side
                and is never included in the app or exposed to your browser. Plaid&apos;s own handling
                of your information is governed by the{' '}
                <a
                  href="https://plaid.com/legal/#end-user-privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-700 dark:text-accent-300 underline underline-offset-2 hover:text-accent-800 dark:hover:text-accent-200"
                >
                  Plaid End User Privacy Policy
                </a>
                . If you never connect a bank account, no data is shared with Plaid.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                6. Data retention &amp; deletion
              </h2>
              <p>
                We keep your data for as long as your household exists and you remain a member. You
                control your data from within the app: you can edit or delete individual items, use
                the in-app &ldquo;export my data&rdquo; feature to download a copy, and use the
                in-app &ldquo;delete household&rdquo; feature to remove a household and its data.
                Deleting a household also disconnects any linked bank account at Plaid, so the
                connection does not outlive the account. To request deletion of any remaining
                personal data associated with your account, contact us at [PLACEHOLDER: contact
                email].
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                7. Children&apos;s use
              </h2>
              <p>
                LifeBalance is not directed to children under [PLACEHOLDER: minimum age], and we do
                not knowingly collect personal information from them. A household member who is a child
                should only use the app under the supervision of a parent or guardian who owns the
                household. If you believe a child has provided us personal information, contact us at
                [PLACEHOLDER: contact email] and we will take appropriate steps.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                8. Changes to this policy
              </h2>
              <p>
                We may update this Privacy Policy as the app evolves. When we make material changes,
                we will update the effective date and policy version above and, where appropriate, ask
                you to re-accept. Your continued use of the app after an update means you accept the
                revised policy.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                9. Contact &amp; governing law
              </h2>
              <p>
                Questions about this policy can be sent to [PLACEHOLDER: contact email] or
                [PLACEHOLDER: mailing address]. This policy is governed by the laws of{' '}
                [PLACEHOLDER: governing law / jurisdiction].
              </p>
            </section>
          </div>

          {/* Footer link */}
          <div className="pt-2 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200 font-medium text-sm"
            >
              <ArrowLeft size={16} />
              <span>Back to sign in</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;

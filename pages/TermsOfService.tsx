import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { CONSENT_VERSION } from '@/utils/legal';

/**
 * Public Terms of Service page (Plan 011).
 *
 * DRAFT copy pending legal review. Every fact a human must own is marked with a
 * bracketed [PLACEHOLDER: …] token — do not replace these with invented values.
 */
const TermsOfService: React.FC = () => {
  return (
    <div className="min-h-screen bg-linear-to-br from-brand-100 via-brand-50 to-money-50 dark:from-brand-900 dark:via-brand-900 dark:to-brand-900 py-10 px-4">
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
              <FileText className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-brand-800 dark:text-brand-100 mb-1">
              Terms of Service
            </h1>
            <p className="text-brand-500 dark:text-brand-400 text-sm">
              The agreement for using LifeBalance
            </p>
          </div>

          {/* DRAFT banner */}
          <div
            role="alert"
            className="rounded-card border border-warm-200 dark:border-warm-700 bg-warm-50 dark:bg-warm-900/40 p-4 text-sm text-warm-800 dark:text-warm-200"
          >
            <p className="font-semibold">DRAFT — pending legal review. Not yet legally binding.</p>
            <p className="mt-1">Effective date: [PLACEHOLDER: effective date]</p>
            <p className="mt-1">Terms version: {CONSENT_VERSION}</p>
          </div>

          {/* Body */}
          <div className="space-y-6 text-sm leading-relaxed text-brand-700 dark:text-brand-300">
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                1. Acceptance of these terms
              </h2>
              <p>
                These Terms of Service (&ldquo;Terms&rdquo;) govern your use of LifeBalance (the
                &ldquo;Service&rdquo;), provided by [PLACEHOLDER: legal entity name]
                (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating or joining a household, you agree to
                these Terms and to our{' '}
                <Link
                  to="/privacy"
                  className="text-brand-600 dark:text-brand-300 underline hover:text-brand-700 dark:hover:text-brand-200"
                >
                  Privacy Policy
                </Link>
                . If you do not agree, do not use the Service.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                2. The Service
              </h2>
              <p>
                LifeBalance helps households track finances, build habits, plan meals, and manage
                shared lists. It is a personal organization tool. The Service does not provide
                financial, investment, tax, legal, or other professional advice, and any figures,
                insights, or suggestions it produces — including AI-generated ones — are for
                informational purposes only and may be inaccurate. You are responsible for the
                decisions you make.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                3. Your account
              </h2>
              <p>
                You sign in with Google and are responsible for the activity under your account and
                for keeping access to it secure. You must provide accurate information and be old
                enough to enter into these Terms (at least [PLACEHOLDER: minimum age]). Access to the
                Service is currently limited and may be granted or revoked at our discretion.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                4. Households &amp; shared data
              </h2>
              <p>
                Households are shared spaces. When you create or join a household using an invite
                code, the other members of that household can see and edit the household&apos;s shared
                data, including financial figures, habits, meals, lists, and to-dos. Only invite
                people you trust, and do not add information you are not comfortable sharing with your
                household members.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                5. Acceptable use
              </h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>Do not use the Service for any unlawful purpose.</li>
                <li>Do not attempt to disrupt, reverse-engineer, or gain unauthorized access to the Service or its data.</li>
                <li>Do not upload content you do not have the right to use, or that infringes others&apos; rights.</li>
                <li>Do not use the Service to harass, abuse, or harm other household members.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                6. AI features
              </h2>
              <p>
                The Service offers optional AI features (such as receipt scanning, statement parsing,
                meal suggestions, and insights) that send data to Google Gemini for processing, as
                described in our{' '}
                <Link
                  to="/privacy"
                  className="text-brand-600 dark:text-brand-300 underline hover:text-brand-700 dark:hover:text-brand-200"
                >
                  Privacy Policy
                </Link>
                . By using these features you consent to that processing. AI output can be wrong;
                review it before relying on it.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                7. Your content
              </h2>
              <p>
                You retain ownership of the content you enter. You grant us a limited license to
                store, process, and display that content solely to operate the Service for you and
                your household. You are responsible for the accuracy and legality of the content you
                provide.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                8. Disclaimers &amp; limitation of liability
              </h2>
              <p>
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
                warranties of any kind to the fullest extent permitted by law. To the maximum extent
                permitted by [PLACEHOLDER: governing law / jurisdiction], we are not liable for any
                indirect, incidental, or consequential damages, or for any loss arising from your use
                of, or reliance on, the Service or its outputs.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                9. Termination
              </h2>
              <p>
                You may stop using the Service at any time and may delete your household and data from
                within the app. We may suspend or terminate access if you violate these Terms or if we
                discontinue the Service.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                10. Changes to these terms
              </h2>
              <p>
                We may update these Terms as the Service evolves. When we make material changes, we
                will update the effective date and version above and, where appropriate, ask you to
                re-accept. Your continued use after an update means you accept the revised Terms.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
                11. Contact &amp; governing law
              </h2>
              <p>
                Questions about these Terms can be sent to [PLACEHOLDER: contact email] or
                [PLACEHOLDER: mailing address]. These Terms are governed by the laws of{' '}
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

export default TermsOfService;

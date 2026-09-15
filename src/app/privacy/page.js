export const metadata = {
  title: 'Privacy Policy — X Monitor',
  description: 'Privacy Policy for X Monitor extension and web dashboard',
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white p-8 max-w-3xl mx-auto font-sans">
      <h1 className="text-2xl font-bold mb-4">Privacy Policy for X Monitor</h1>
      <p className="text-sm text-gray-400 mb-6">Last updated: August 26, 2026</p>
      
      <section className="space-y-4 text-sm text-gray-300 leading-relaxed">
        <p>
          <strong>X Monitor</strong> (&quot;the Extension&quot; and &quot;the Service&quot;) is committed to protecting your privacy.
        </p>
        
        <h2 className="text-lg font-semibold text-white pt-2">1. Data Collection</h2>
        <p>
          X Monitor does <strong>not</strong> collect, store, sell, or transmit any personal identifiable information (PII), browsing history, keystrokes, or account credentials.
        </p>

        <h2 className="text-lg font-semibold text-white pt-2">2. Local Storage</h2>
        <p>
          The extension uses Chrome/Edge local storage strictly on your local device to remember your UI display preferences (such as selected post counts). This data never leaves your computer.
        </p>

        <h2 className="text-lg font-semibold text-white pt-2">3. Network Communication</h2>
        <p>
          The extension connects to our public read-only API endpoint to fetch public breaking financial news and media tweets for display in the side panel. No user data is sent during these requests.
        </p>

        <h2 className="text-lg font-semibold text-white pt-2">4. Contact</h2>
        <p>
          If you have questions regarding this privacy policy, you can contact the developer via our official GitHub repository.
        </p>
      </section>
    </div>
  );
}

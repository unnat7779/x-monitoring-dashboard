import "./globals.css";

export const metadata = {
  title: "X Monitoring Dashboard | Real-Time Live Stream",
  description: "Real-time Twitter/X monitoring dashboard for @YatinMota, @ANI, and @SoumeetSarkar via TwitterAPI.io webhooks and AWS S3 storage.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col font-sans bg-[#0a0a0f] text-[#f0f0f5]">
        {children}
      </body>
    </html>
  );
}

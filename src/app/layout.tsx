import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Themis | Litigation Case Intelligence',
  description: 'Discover, evaluate, and track litigation cases with AI-powered search and personalized ranking.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="noise-bg min-h-screen">
        {children}
      </body>
    </html>
  );
}

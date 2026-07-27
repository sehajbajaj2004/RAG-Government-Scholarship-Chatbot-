import './globals.css';

export const metadata = {
  title: 'Scholarship Assistant (Lite)',
  description: 'RAG chatbot over Indian government scholarship guideline documents.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

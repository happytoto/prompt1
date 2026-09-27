import './globals.css';

export const metadata = {
  title: '한줄설계 · 프롬프트 1앱',
  description: '한 줄 입력으로 역할·맥락·입력·처리·출력·검증·보안을 갖춘 프롬프트를 만듭니다.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: '한줄설계', statusBarStyle: 'default' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf7e9' },
    { media: '(prefers-color-scheme: dark)', color: '#16150f' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

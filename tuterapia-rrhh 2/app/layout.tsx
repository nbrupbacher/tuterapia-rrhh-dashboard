import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tu Terapia · RRHH Dashboard',
  description: 'Dashboard de performance de terapeutas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

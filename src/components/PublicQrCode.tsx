import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface PublicQrCodeProps {
  value: string;
  size?: number;
  className?: string;
  darkColor?: string;
  lightColor?: string;
}

export const PublicQrCode: React.FC<PublicQrCodeProps> = ({
  value,
  size = 120,
  className = '',
  darkColor = '#000000',
  lightColor = '#ffffff'
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let isCurrent = true;
    QRCode.toDataURL(value, {
      width: size * 2, // high DPI
      margin: 1,
      color: {
        dark: darkColor,
        light: lightColor
      },
      errorCorrectionLevel: 'M'
    })
      .then((url) => {
        if (isCurrent) setDataUrl(url);
      })
      .catch((err) => {
        console.error('Erro ao gerar QRCode:', err);
      });

    return () => {
      isCurrent = false;
    };
  }, [value, size, darkColor, lightColor]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200 ${className}`}
      >
        <span className="material-symbols-outlined text-base animate-pulse">qr_code</span>
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt="Código QR de Validação"
      style={{ width: size, height: size }}
      className={`object-contain block ${className}`}
    />
  );
};

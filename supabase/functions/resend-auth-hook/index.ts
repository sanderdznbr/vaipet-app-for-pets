import { serve } from "https://deno.land/std@0.190.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VAIPET_LOGO = 'https://vaipet.app/logo.png'; // Assuming this is the logo path, fallback to text if broken
const PRIMARY_COLOR = '#31D880';
const BG_COLOR = '#F2F2F7';

const emailWrapper = (content: string) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1C1C1E; background-color: white; border-radius: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: ${PRIMARY_COLOR}; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">VaiPet</h1>
    </div>
    
    ${content}
    
    <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #E5E5EA; text-align: center;">
      <p style="font-size: 13px; color: #8E8E93; line-height: 1.4;">
        © 2026 VaiPet. Todos os direitos reservados.<br>
        O app feito com amor para o seu pet. 🐾<br>
        <a href="https://vaipet.app" style="color: ${PRIMARY_COLOR}; text-decoration: none; font-weight: 600;">vaipet.app</a>
      </p>
    </div>
  </div>
`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json();
    const { event, email, otp } = payload;
    
    if (!email) {
      return new Response(JSON.stringify({ message: "No email provided" }), { status: 200 });
    }

    let subject = "VaiPet";
    let bodyContent = "";

    if (event === 'signup' || event === 'resend_otp') {
      subject = "Seu código de verificação VaiPet";
      bodyContent = `
        <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 16px; text-align: center; letter-spacing: -0.4px;">Verifique seu e-mail</h2>
        <p style="font-size: 16px; line-height: 24px; color: #3A3A3C; text-align: center; margin-bottom: 32px;">
          Olá! Use o código abaixo para confirmar sua conta e começar a usar o VaiPet.
        </p>
        <div style="background: ${BG_COLOR}; padding: 32px; text-align: center; border-radius: 20px; margin-bottom: 32px;">
          <span style="font-size: 42px; font-weight: 800; letter-spacing: 12px; color: #1C1C1E; font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #8E8E93; text-align: center;">
          Este código expira em 10 minutos. Se você não solicitou este e-mail, pode ignorá-lo.
        </p>
      `;
    } else if (event === 'recovery') {
      subject = "Recupere sua senha no VaiPet";
      bodyContent = `
        <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 16px; text-align: center; letter-spacing: -0.4px;">Recuperação de Senha</h2>
        <p style="font-size: 16px; line-height: 24px; color: #3A3A3C; text-align: center; margin-bottom: 32px;">
          Recebemos uma solicitação para redefinir sua senha. Utilize o código de segurança abaixo:
        </p>
        <div style="background: ${BG_COLOR}; padding: 32px; text-align: center; border-radius: 20px; margin-bottom: 32px;">
          <span style="font-size: 42px; font-weight: 800; letter-spacing: 12px; color: #1C1C1E; font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;">${otp}</span>
        </div>
        <p style="font-size: 16px; line-height: 24px; color: #3A3A3C; text-align: center;">
          Insira este código no aplicativo para criar uma nova senha.
        </p>
      `;
    } else if (event === 'magiclink' || event === 'email_change' || event === 'user_invitation') {
      // Catch-all for other auth events that might send plain links
      subject = "Ação necessária no VaiPet";
      bodyContent = `
        <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 16px; text-align: center; letter-spacing: -0.4px;">Autenticação VaiPet</h2>
        <p style="font-size: 16px; line-height: 24px; color: #3A3A3C; text-align: center; margin-bottom: 32px;">
          Você solicitou uma ação de acesso. Use o código abaixo:
        </p>
        <div style="background: ${BG_COLOR}; padding: 32px; text-align: center; border-radius: 20px; margin-bottom: 32px;">
          <span style="font-size: 42px; font-weight: 800; letter-spacing: 12px; color: #1C1C1E; font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;">${otp}</span>
        </div>
      `;
    } else {
      console.log(`Unhandled event: ${event}`);
      return new Response(JSON.stringify({ message: `Event ${event} not handled` }), { status: 200 });
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'VaiPet <noreply@vaipet.app>',
        to: [email],
        subject: subject,
        html: emailWrapper(bodyContent),
      }),
    });

    const resData = await res.json();
    return new Response(JSON.stringify(resData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: res.status,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})
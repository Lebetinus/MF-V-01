import { clearSessionCookieHeader, clearViewCookieHeader, destroySession, destroyViewSession, getSessionToken, getViewToken } from "../../_lib/auth";
import { json, withErrorHandling } from "../../_lib/http";

export const POST = withErrorHandling(async (request: Request) => {
  // "Kullanıcı gözüyle" görünümdeyken Çıkış yalnız görünümü kapatır; süper admin kendi oturumuna döner.
  const viewToken = getViewToken(request);
  if (viewToken) {
    await destroyViewSession(viewToken);
    return json({ ok: true, endedView: true }, { headers: { "Set-Cookie": clearViewCookieHeader() } });
  }
  const token = getSessionToken(request);
  if (token) await destroySession(token);
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
});

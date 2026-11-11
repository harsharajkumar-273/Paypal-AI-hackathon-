// Public origin of the web app. Render sets RENDER_EXTERNAL_URL on web services, so a
// hosted deploy works before APP_URL is filled in.
export function appUrl() {
  return (
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
}

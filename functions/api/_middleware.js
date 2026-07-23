export async function onRequest(context) {
    try {
        const { request } = context;
        const headersObj = {};
        for (const [key, value] of request.headers.entries()) {
            headersObj[key] = value;
        }

        let userId = '';
        try {
            const token = request.headers.get('x-lg-token') || 
                          (request.headers.get('authorization') || '').replace(/^bearer\s+/i, '').trim();
            if (token) {
                const parts = token.split('.');
                if (parts.length === 3) {
                    // Quick decode of JWT payload without blocking verification
                    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                    userId = payload.sub || '';
                }
            }
        } catch (err) {
            // ignore token parsing errors
        }

        const logData = {
            timestamp: new Date().toISOString(),
            ip: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '',
            country: request.headers.get('cf-ipcountry') || '',
            userId: userId,
            method: request.method,
            path: new URL(request.url).pathname,
            userAgent: request.headers.get('user-agent') || '',
            headers: headersObj
        };
        console.log(`[ANALYTICS_LOG] ${JSON.stringify(logData)}`);
    } catch (e) {
        // fail silently to avoid blocking business logic
        console.error('Logger error:', e);
    }
    
    // Pass to the next middleware or actual API route
    return context.next();
}

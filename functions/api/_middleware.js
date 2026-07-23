export async function onRequest(context) {
    try {
        const { request } = context;
        const headersObj = {};
        for (const [key, value] of request.headers.entries()) {
            headersObj[key] = value;
        }
        const logData = {
            timestamp: new Date().toISOString(),
            ip: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '',
            country: request.headers.get('cf-ipcountry') || '',
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

import { requireAuth } from '../../_lib/auth.js';
import { isAdmin } from '../../_lib/db.js';
import { HttpError, json, errorResponse } from '../../_lib/http.js';
import { AwsClient } from 'aws4fetch';

export async function onRequest({ request, env, params }) {
  const method = request.method;
  if (method !== 'GET' && method !== 'DELETE') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const pathArray = params.path;
    if (!pathArray || !Array.isArray(pathArray) || pathArray.length === 0) {
      throw new HttpError(400, '无效的路径');
    }

    const key = `images/${pathArray.join('/')}`;
    
    // 防御路径穿越等
    if (key.includes('..') || key.includes('\\') || key.includes('\0')) {
      throw new HttpError(403, '禁止访问该路径');
    }
    
    if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_BUCKET_NAME || !env.B2_ENDPOINT) {
      throw new HttpError(500, '服务器存储配置缺失');
    }

    const aws = new AwsClient({
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APPLICATION_KEY,
      service: 's3',
      region: env.B2_REGION || 'auto'
    });

    const endpoint = new URL(env.B2_ENDPOINT);
    const s3Url = new URL(`/${env.B2_BUCKET_NAME}/${key}`, endpoint);

    if (method === 'GET') {
      const cache = caches.default;
      let response = await cache.match(request);
      
      if (!response) {
        // 请求 B2
        const s3Request = await aws.sign(s3Url.toString(), {
          method: 'GET'
        });
        
        let s3Response = await fetch(s3Request);
        
        if (s3Response.status === 404) {
          throw new HttpError(404, '图片未找到');
        }
        
        if (!s3Response.ok) {
          throw new HttpError(500, '存储服务器响应异常');
        }

        // 构造新的 Response 剥离敏感 Header，如 x-amz-request-id
        const headers = new Headers();
        const allowedHeaders = ['content-type', 'content-length', 'etag', 'last-modified'];
        
        for (const [k, v] of s3Response.headers.entries()) {
          if (allowedHeaders.includes(k.toLowerCase())) {
            headers.set(k, v);
          }
        }
        
        headers.set('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
        headers.set('X-Content-Type-Options', 'nosniff');

        response = new Response(s3Response.body, {
          status: s3Response.status,
          headers
        });
        
        // 只有 200 才缓存
        if (s3Response.status === 200) {
          // Clone request to use as cache key (without query string optionally, but default is fine)
          await cache.put(request, response.clone());
        }
      }
      
      return response;
    }

    if (method === 'DELETE') {
      const { profile } = await requireAuth(request, env);
      
      // 验证权限：目前只允许管理员删除，或者上传者自己
      // 理论上应该通过 HEAD 请求拿到 x-amz-meta-uploader-id，但为了减少请求也可以只允许管理员删除，或在 B2 里记录到 D1
      // 这里先请求 HEAD 验证所有权
      const headReq = await aws.sign(s3Url.toString(), { method: 'HEAD' });
      const headRes = await fetch(headReq);
      
      if (headRes.status === 404) {
        throw new HttpError(404, '图片未找到');
      }
      if (!headRes.ok) {
        throw new HttpError(500, '无法获取图片信息');
      }
      
      const uploaderId = headRes.headers.get('x-amz-meta-uploader-id');
      const isOwner = String(uploaderId) === String(profile.id);
      
      if (!isOwner && !isAdmin(profile)) {
        throw new HttpError(403, '无权删除该图片');
      }

      const delReq = await aws.sign(s3Url.toString(), { method: 'DELETE' });
      const delRes = await fetch(delReq);
      
      if (!delRes.ok) {
        throw new HttpError(500, '删除图片失败');
      }
      
      // 清除缓存
      const cache = caches.default;
      // Note: cache.delete is not supported consistently in Workers/Pages, 
      // but we can try ignoring the error if it's not supported.
      try { await cache.delete(request); } catch (e) {}

      return json({ success: true, message: '删除成功' }, 200, {
        'X-Content-Type-Options': 'nosniff'
      });
    }
  } catch (error) {
    if (error instanceof HttpError) {
      if (method === 'GET' && error.status === 404) {
        return new Response('Not Found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' }});
      }
      return errorResponse(error);
    }
    return new Response(JSON.stringify({ success: false, error: '服务器内部错误' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
}

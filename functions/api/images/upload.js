import { requireAuth } from '../../_lib/auth.js';
import { HttpError, json } from '../../_lib/http.js';
import { AwsClient } from 'aws4fetch';

export async function onRequestPost({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    const userId = String(profile.id);

    if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_BUCKET_NAME || !env.B2_ENDPOINT) {
      throw new HttpError(500, '服务器存储配置缺失');
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) throw new HttpError(400, '请求格式错误，期望 multipart/form-data');
    
    const file = formData.get('file');
    if (!file || typeof file === 'string' || !file.arrayBuffer) {
      throw new HttpError(400, '未找到文件或字段不正确');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new HttpError(413, '图片大小不能超过 5MB');
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      throw new HttpError(400, '不支持的文件类型，仅支持 JPG, PNG, WEBP, GIF');
    }
    
    const buffer = await file.arrayBuffer();
    
    // 检查文件头
    const arr = new Uint8Array(buffer).subarray(0, 4);
    const header = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    
    let ext = '';
    let valid = false;
    
    if (header.startsWith('FFD8FF')) { ext = 'jpg'; valid = true; }
    else if (header.startsWith('89504E47')) { ext = 'png'; valid = true; }
    else if (header.startsWith('47494638')) { ext = 'gif'; valid = true; }
    else if (header.startsWith('52494646')) {
       const webpCheck = new Uint8Array(buffer).subarray(8, 12);
       const webpStr = Array.from(webpCheck).map(b => String.fromCharCode(b)).join('');
       if (webpStr === 'WEBP') { ext = 'webp'; valid = true; }
    }
    
    if (!valid || !ext) {
      throw new HttpError(400, '文件内容与扩展名不符或为不支持的文件');
    }

    const date = new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const uuid = crypto.randomUUID();
    const key = `images/${year}/${month}/${uuid}.${ext}`;

    const aws = new AwsClient({
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APPLICATION_KEY,
      service: 's3',
      region: env.B2_REGION || 'auto'
    });

    const endpoint = new URL(env.B2_ENDPOINT);
    const uploadUrl = new URL(`/${env.B2_BUCKET_NAME}/${key}`, endpoint);

    const s3Request = await aws.sign(uploadUrl.toString(), {
      method: 'PUT',
      body: buffer,
      headers: {
        'Content-Type': file.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'x-amz-meta-uploader-id': userId
      }
    });

    const s3Response = await fetch(s3Request);

    if (!s3Response.ok) {
      throw new HttpError(500, '图片上传到存储服务器失败');
    }

    return json({
      success: true,
      key: key,
      url: `/api/${key}`,
      contentType: file.type,
      size: file.size
    }, 200, {
      'X-Content-Type-Options': 'nosniff'
    });

  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
}

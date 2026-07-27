/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transformers.js loads native ONNX runtime bindings and must be required by Node
  // rather than bundled. (Next already externalises it by default; pinned here so an
  // upstream change to that default list cannot silently break /api/chat.)
  serverExternalPackages: ['@huggingface/transformers'],
};

export default nextConfig;

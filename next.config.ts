import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /*
        Raised from the 1MB default for the history importer.

        A dealership's five years of declined services is a few megabytes of
        CSV, and the default rejects it before any of our own validation runs —
        with an error about request size that says nothing about what to do.

        Four megabytes is chosen against the row cap rather than pulled from
        the air: `MAX_IMPORT_ROWS` is 30,000, and a decline row is roughly 100
        bytes, so the cap binds before this does. That is the order we want —
        somebody hitting a limit should be told "split the file, here is why"
        by the importer, not handed a transport error by the framework.

        Netlify's own function payload ceiling sits above this, so it is not
        the binding constraint either. Anything genuinely larger wants a direct
        upload to storage and a background job, which is a real piece of work
        and deliberately not pretended at here.
      */
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;

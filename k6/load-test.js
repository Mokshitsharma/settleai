import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "10s", target: 20 },
    { duration: "20s", target: 50 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<250"], // 95% of requests must complete below 250ms
    http_req_failed: ["rate<0.01"],    // <1% errors
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  // 1. Health probe
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    "health status is 200": (r) => r.status === 200,
  });

  // 2. Mandate validation probe
  const mandateRes = http.get(`${BASE_URL}/api/v1/mandates/verify-status`);
  check(mandateRes, {
    "mandate check responded": (r) => r.status < 500,
  });

  sleep(0.1);
}

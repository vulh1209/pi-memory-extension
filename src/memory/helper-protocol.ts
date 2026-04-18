export interface HelperRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface HelperSuccessResponse {
  id: string;
  result: unknown;
}

export interface HelperErrorResponse {
  id: string;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type HelperResponse = HelperSuccessResponse | HelperErrorResponse;

export function isHelperErrorResponse(value: HelperResponse): value is HelperErrorResponse {
  return 'error' in value;
}

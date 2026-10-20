/** Only a resolved parcel with unreliable contents should notify office. */
export class ReturnReviewRequiredError extends Error {
  constructor(message: string, readonly shipmentId?: string, readonly parcelNumber?: string) {
    super(message);
    this.name = "ReturnReviewRequiredError";
  }
}

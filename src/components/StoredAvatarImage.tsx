import { AvatarImage } from "@/components/ui/avatar";
import { useSignedUrl } from "@/hooks/useSignedUrl";

/**
 * Drop-in replacement for <AvatarImage> whose `src` is a private-bucket object
 * path (e.g. employees.photo_url). Signs the path on the fly; renders nothing
 * (letting <AvatarFallback> show) until the signed URL resolves.
 */
export function StoredAvatarImage({
  path,
  bucket = "employee-photos",
  className,
  alt,
}: {
  path?: string | null;
  bucket?: string;
  className?: string;
  alt?: string;
}) {
  const { data: url } = useSignedUrl(path, bucket);
  return <AvatarImage src={url ?? undefined} className={className} alt={alt} />;
}

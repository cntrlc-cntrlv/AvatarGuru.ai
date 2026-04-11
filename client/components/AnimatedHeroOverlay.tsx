export function AnimatedHeroOverlay() {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none flex items-center justify-center overflow-hidden">
      <img
        src="/animated-video.gif"
        alt="Animated Learning Scene"
        className="w-full h-full object-contain object-center"
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          objectPosition: "center",
          display: "block",
          mixBlendMode: "multiply",
        }}
        onLoad={() => console.log("GIF loaded successfully")}
        onError={(e) => console.error("GIF failed to load:", e)}
      />
    </div>
  );
}

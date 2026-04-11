import { Link } from "react-router-dom";
import { AnimatedHeroOverlay } from "@/components/AnimatedHeroOverlay";
import { useEffect, useRef, useState } from "react";

export function Home() {
  const [activeSection, setActiveSection] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + window.innerHeight / 2;

      sectionRefs.current.forEach((ref, index) => {
        if (ref) {
          const rect = ref.getBoundingClientRect();
          const elementTop = rect.top + window.scrollY;
          const elementBottom = elementTop + rect.height;

          if (scrollPosition >= elementTop && scrollPosition <= elementBottom) {
            setActiveSection(index);
          }
        }
      });
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll(); // Initial check

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24 ">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          {/* Left Column - Copy */}
          <div className="flex flex-col justify-center order-2 lg:order-1">
            <h1 className="text-4xl lg:text-5xl font-light text-muted-foreground mb-6 tracking-wide">
              EDUCATION
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed font-light">
              AvatarGuru.ai provides a completely interactive and adaptive
              learning experience. We use AI to manage and customize your
              educational journey, ensuring that every piece of content, every
              quiz, and every challenge is perfectly matched to your current
              skill level and goals. This intelligent path transforms passive
              studying into active, successful, and enduring learning .
            </p>
            <div className="flex gap-4 flex-wrap">
              <Link
                to="/study"
                className="px-8 py-3 bg-[hsl(var(--button-lavender))] text-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity"
              >
                GET STARTED
              </Link>
            </div>
          </div>

          {/* Right Column - Illustration */}
          <div className="flex items-center justify-center order-1 lg:order-2 relative">
            <div className="w-full max-w-md h-96 relative">
              <AnimatedHeroOverlay />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl lg:text-6xl font-light text-foreground mb-6">
            How It Works
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Experience the power of AI-driven learning with our intuitive
            platform
          </p>
        </div>

        {/* Application UI Preview (redesigned) */}
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl p-6 mb-12">
          {/* Main Image */}
          <div className="mb-8">
            <img
              src="/how it works image/main.png"
              alt="AvatarGuru.ai Main Interface"
              className="w-full h-auto rounded-xl shadow-lg"
            />
          </div>

          {/* UI Interface Toggle Button */}
          <div className="text-center mt-8">
            <button className="px-8 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-semibold hover:opacity-90 transition-opacity shadow-lg">
              View Different Interface
            </button>
          </div>
        </div>

        {/* Feature Flow */}
        <div className="relative">
          {/* Animated Connecting Line */}
          <div className="absolute left-1/2 transform -translate-x-1/2 w-1 h-full">
            {/* Base dotted line */}
            <div className="w-full h-full border-l-2 border-dashed border-gray-300"></div>
            {/* Animated progress line */}
            <div
              className="absolute top-0 left-0 w-full border-l-2 border-solid border-purple-500 transition-all duration-1000 ease-out"
              style={{
                height: `${(activeSection + 1) * 25}%`,
                boxShadow:
                  "0 0 20px rgba(147, 51, 234, 0.5), 0 0 40px rgba(147, 51, 234, 0.3)",
                filter: "blur(0.5px)",
              }}
            ></div>
          </div>

          <div className="space-y-32">
            {/* First Flow Item */}
            <div
              ref={(el) => (sectionRefs.current[0] = el)}
              className="relative flex items-center gap-20"
            >
              {/* Left Content */}
              <div className="flex-1 text-right pr-16">
                <h3
                  className="text-3xl lg:text-4xl font-light text-foreground mb-8 tracking-wide"
                  style={{ fontFamily: "Inter, system-ui, sans-serif" }}
                >
                  Understand complex topics in a flash
                </h3>
                <p
                  className="text-lg text-muted-foreground leading-relaxed font-light"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  Get straight to the point quickly with AI generated notes and
                  summaries. Simply upload a web link, video, PDF, or voice
                  recording to instantly get detailed, structured smart notes or
                  a scannable summary of your material in seconds.
                </p>
              </div>

              {/* Center Node */}
              <div className="relative z-10">
                <div
                  className={`w-10 h-10 rounded-full shadow-lg transition-all duration-500 ${
                    activeSection >= 0
                      ? "bg-purple-500 shadow-purple-500/50 scale-110"
                      : "bg-gray-400"
                  }`}
                  style={{
                    boxShadow:
                      activeSection >= 0
                        ? "0 0 20px rgba(147, 51, 234, 0.6), 0 0 40px rgba(147, 51, 234, 0.4)"
                        : "0 4px 6px rgba(0, 0, 0, 0.1)",
                  }}
                ></div>
              </div>

              {/* Right Content - AI Summary Image */}
              <div className="flex-1 pl-16">
                <div className="rounded-xl overflow-hidden shadow-lg">
                  <img
                    src="/how it works image/ai summary.png"
                    alt="AI Summary Interface"
                    className="w-full h-auto"
                  />
                </div>
              </div>
            </div>

            {/* Second Flow Item */}
            <div
              ref={(el) => (sectionRefs.current[1] = el)}
              className="relative flex items-center gap-20"
            >
              {/* Left Content - AI Assistant Image */}
              <div className="flex-1 pr-16">
                <div className="rounded-xl overflow-hidden shadow-lg">
                  <img
                    src="/how it works image/ai assistant.png"
                    alt="AI Assistant Interface"
                    className="w-full h-auto"
                  />
                </div>
              </div>

              {/* Center Node */}
              <div className="relative z-10">
                <div
                  className={`w-10 h-10 rounded-full shadow-lg transition-all duration-500 ${
                    activeSection >= 1
                      ? "bg-purple-500 shadow-purple-500/50 scale-110"
                      : "bg-gray-400"
                  }`}
                  style={{
                    boxShadow:
                      activeSection >= 1
                        ? "0 0 20px rgba(147, 51, 234, 0.6), 0 0 40px rgba(147, 51, 234, 0.4)"
                        : "0 4px 6px rgba(0, 0, 0, 0.1)",
                  }}
                ></div>
              </div>

              {/* Right Content */}
              <div className="flex-1 pl-16">
                <h3
                  className="text-3xl lg:text-4xl font-light text-foreground mb-8 tracking-wide"
                  style={{ fontFamily: "Inter, system-ui, sans-serif" }}
                >
                  Get reliable and accurate answers to any question
                </h3>
                <p
                  className="text-lg text-muted-foreground leading-relaxed font-light"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  Enable endless AI wisdom with a simple message to the AI
                  assistant. Ask a question about a specific content upload, or
                  ask it to search the entire internet to give you relevant
                  references and live links.
                </p>
              </div>
            </div>

            {/* Third Flow Item */}
            <div
              ref={(el) => (sectionRefs.current[2] = el)}
              className="relative flex items-center gap-20"
            >
              {/* Left Content */}
              <div className="flex-1 text-right pr-16">
                <h3
                  className="text-3xl lg:text-4xl font-light text-foreground mb-8 tracking-wide"
                  style={{ fontFamily: "Inter, system-ui, sans-serif" }}
                >
                  Turn Knowledge into Mastery
                </h3>
                <p
                  className="text-lg text-muted-foreground leading-relaxed font-light"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  To help you memorize and retain information better,
                  auto-generate flashcards and quizzes to put your new knowledge
                  to use. Let AI do the heavy lifting of building flashcards or
                  quiz questions, and spend your time actually learning the
                  material instead.
                </p>
              </div>

              {/* Center Node */}
              <div className="relative z-10">
                <div
                  className={`w-10 h-10 rounded-full shadow-lg transition-all duration-500 ${
                    activeSection >= 2
                      ? "bg-purple-500 shadow-purple-500/50 scale-110"
                      : "bg-gray-400"
                  }`}
                  style={{
                    boxShadow:
                      activeSection >= 2
                        ? "0 0 20px rgba(147, 51, 234, 0.6), 0 0 40px rgba(147, 51, 234, 0.4)"
                        : "0 4px 6px rgba(0, 0, 0, 0.1)",
                  }}
                ></div>
              </div>

              {/* Right Content - Questions Image */}
              <div className="flex-1 pl-16">
                <div className="rounded-xl overflow-hidden shadow-lg">
                  <img
                    src="/how it works image/questions.png"
                    alt="Questions & Quizzes Interface"
                    className="w-full h-auto"
                  />
                </div>
              </div>
            </div>

            {/* Fourth Flow Item */}
            <div
              ref={(el) => (sectionRefs.current[3] = el)}
              className="relative flex items-center gap-20"
            >
              {/* Left Content - File Management Image */}
              <div className="flex-1 pr-16">
                <div className="rounded-xl overflow-hidden shadow-lg">
                  <img
                    src="/how it works image/file managment .png"
                    alt="File Management Interface"
                    className="w-full h-auto"
                  />
                </div>
              </div>

              {/* Center Node */}
              <div className="relative z-10">
                <div
                  className={`w-10 h-10 rounded-full shadow-lg transition-all duration-500 ${
                    activeSection >= 3
                      ? "bg-purple-500 shadow-purple-500/50 scale-110"
                      : "bg-gray-400"
                  }`}
                  style={{
                    boxShadow:
                      activeSection >= 3
                        ? "0 0 20px rgba(147, 51, 234, 0.6), 0 0 40px rgba(147, 51, 234, 0.4)"
                        : "0 4px 6px rgba(0, 0, 0, 0.1)",
                  }}
                ></div>
              </div>

              {/* Right Content */}
              <div className="flex-1 pl-16">
                <h3
                  className="text-3xl lg:text-4xl font-light text-foreground mb-8 tracking-wide"
                  style={{ fontFamily: "Inter, system-ui, sans-serif" }}
                >
                  Organize and Manage your study materials
                </h3>
                <p
                  className="text-lg text-muted-foreground leading-relaxed font-light"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  Easily keep all your notes, flashcards, and quizzes structured
                  with folders. Group your content by class, topic, or exam so
                  everything stays in one place. With built-in organization
                  tools, you'll spend less time searching and more time actually
                  learning.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Simple CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
        <div className="text-center">
          <h2 className="text-3xl lg:text-4xl font-semibold text-foreground mb-6">
            Ready to Start Learning?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join our platform and begin your journey to mastering new skills and
            knowledge.
          </p>
          <Link
            to="/study"
            className="inline-block px-8 py-3 bg-primary text-white rounded-lg font-semibold hover:opacity-90 transition-opacity"
          >
            Get Started
          </Link>
        </div>
      </section>
    </div>
  );
}

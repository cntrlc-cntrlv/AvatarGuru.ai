import { Link } from "react-router-dom";

export function Navigation() {
  return (
    <div className="sticky top-0 z-50 bg-gradient-to-r ">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="bg-white rounded-full px-6 py-2 bg-gradient-to-r from-purple-50 to-blue-100 shadow-lg">
          <div className="flex justify-between items-center">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3">
              <img
                src="/favicon.ico"
                alt="AvatarGuru.ai"
                className="w-6 h-6 rounded-md"
              />
              <span
                className="text-lg font-black tracking-wider text-gray-800"
                style={{ fontFamily: "Arial Black, sans-serif" }}
              >
                AVATARGURU.AI
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-6">
              <Link
                to="/login"
                className="text-sm text-gray-600 hover:text-gray-800 transition-colors font-medium"
              >
                Login
              </Link>
              <Link
                to="/library"
                className="text-sm text-gray-600 hover:text-gray-800 transition-colors font-medium"
              >
                Library
              </Link>
              <Link
                to="/study"
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full font-semibold hover:opacity-90 transition-opacity shadow-md"
              >
                Start Now
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <div className="md:hidden">
              <button className="text-gray-600 hover:text-gray-800 transition-colors">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

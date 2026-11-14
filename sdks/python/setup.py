from setuptools import setup, find_packages

setup(
    name="ibs-bcstudio",
    version="1.0.0",
    description="Production-grade Python SDK for Microsoft Dynamics 365 Business Central OData v4 API",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="BCStudio",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=["requests>=2.28"],
    extras_require={
        "supabase":   ["supabase>=2.0"],
        "sqlserver":  ["pyodbc>=4.0"],
        "all":        ["supabase>=2.0", "pyodbc>=4.0"],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Topic :: Software Development :: Libraries",
    ],
)

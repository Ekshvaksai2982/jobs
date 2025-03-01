const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const app = express();
const port = 3000;

// Enable CORS
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Function to read Excel data
function readExcelData(filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0]; // Assume the data is in the first sheet
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    return jsonData;
  } catch (error) {
    console.error('Error reading Excel file:', error);
    return [];
  }
}

// Function to append data to Excel
function appendToExcel(filePath, data) {
  let workbook;
  let worksheet;

  // Check if the file exists
  if (fs.existsSync(filePath)) {
    workbook = xlsx.readFile(filePath);
    worksheet = workbook.Sheets[workbook.SheetNames[0]];
  } else {
    // If file doesn't exist, create a new workbook and worksheet
    workbook = xlsx.utils.book_new();
    worksheet = xlsx.utils.json_to_sheet([]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'UserData');
    // Define headers
    xlsx.utils.sheet_add_json(worksheet, [{
      'First Name': '',
      'Email': '',
      'Phone': '',
      'Signup Date': '',
      'Signup Time': '',
      'Job Role': '',
      'Probability Score': '',
      'Resume File': ''
    }], { skipHeader: false, origin: 'A1' });
  }

  // Convert worksheet to JSON to append new data
  const existingData = xlsx.utils.sheet_to_json(worksheet);
  existingData.push(data);

  // Update worksheet with new data
  const newWorksheet = xlsx.utils.json_to_sheet(existingData);
  workbook.Sheets[workbook.SheetNames[0]] = newWorksheet;

  // Write back to the file
  xlsx.writeFile(workbook, filePath);
}

// Define a simple route
app.get('/', (req, res) => {
  res.send('Hello, world!');
});

// Handle file uploads and analyze resume
app.post('/upload', upload.single('resume'), async (req, res) => {
  console.log('File received:', req.file);
  const { firstName, email, phone, jobRole } = req.body;

  if (!req.file) {
    console.error('No file uploaded');
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Construct the file path
    const filePath = path.join(__dirname, req.file.path);

    // Read the uploaded resume file
    let dataBuffer = fs.readFileSync(filePath);
    const resumeFileName = req.file.originalname;

    // Extract text from the PDF
    const data = await pdfParse(dataBuffer);
    let resumeText = data.text;

    // Read the Excel data (use a relative path for the Excel file)
    const excelData = readExcelData(path.join(__dirname, 'jobrolespskillsframeworks.xlsx'));

    // Perform analysis on the extracted text
    let analysisResult = analyzeResume(resumeText, jobRole, excelData);

    // Generate response data
    const response = {
      jobRole: jobRole,
      probability: analysisResult.probability,
      additionalSkills: analysisResult.additionalSkills,
      additionalFrameworks: analysisResult.additionalFrameworks,
      feedback: analysisResult.feedback,
    };

    // Get current date and time
    const now = new Date();
    const signupDate = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const signupTime = now.toLocaleTimeString('en-US', { hour12: false });

    // Data to append to Excel
    const excelDataRow = {
      'First Name': firstName || 'N/A',
      'Email': email || 'N/A',
      'Phone': phone || 'N/A',
      'Signup Date': signupDate,
      'Signup Time': signupTime,
      'Job Role': jobRole || 'N/A',
      'Probability Score': analysisResult.probability,
      'Resume File': resumeFileName
    };

    // Append data to userdata.xlsx
    const excelFilePath = path.join(__dirname, 'userdata.xlsx');
    appendToExcel(excelFilePath, excelDataRow);

    // Delete the uploaded file after processing
    fs.unlinkSync(filePath);

    res.json(response);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Error processing request' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

// Function to analyze resume text
function analyzeResume(resumeText, jobRole, excelData) {
  const jobData = excelData.find(item => item['JOB ROLES'] === jobRole);
  if (!jobData) {
    return {
      jobRole,
      probability: 0,
      additionalSkills: 'Job role not found in the dataset',
      additionalFrameworks: 'Job role not found in the dataset',
      feedback: 'Job role not found in the dataset',
    };
  }

  const requiredSkills = jobData['PROGRAMMING SKILLS'].split(',').map(skill => skill.trim());
  const requiredFrameworks = jobData['FRAMEWORKS'].split(',').map(framework => framework.trim());
  const skillsFound = [];
  const frameworksFound = [];
  const additionalSkills = [];
  const additionalFrameworks = [];
  let probability = 0;
  let feedback = 'Better luck next time. Consider improving your skills in certain areas.';

  // Check for required skills
  requiredSkills.forEach(skill => {
    if (resumeText.toLowerCase().includes(skill.toLowerCase())) {
      skillsFound.push(skill);
    } else {
      additionalSkills.push(skill);
    }
  });

  // Check for required frameworks
  requiredFrameworks.forEach(framework => {
    if (resumeText.toLowerCase().includes(framework.toLowerCase())) {
      frameworksFound.push(framework);
    } else {
      additionalFrameworks.push(framework);
    }
  });

  // Calculate match probability
  const skillsProbability = (skillsFound.length / requiredSkills.length) * 50;
  const frameworksProbability = (frameworksFound.length / requiredFrameworks.length) * 50;
  probability = skillsProbability + frameworksProbability;

  // Generate feedback
  if (probability === 100) {
    feedback = 'Great job! You are a perfect match for this role!';
  } else if (probability >= 50) {
    feedback = 'You have some of the required skills and frameworks. Consider improving the following areas: ' + additionalSkills.join(', ') + ', ' + additionalFrameworks.join(', ');
  } else {
    feedback = 'You need to improve your skills and frameworks significantly. Consider learning: ' + additionalSkills.join(', ') + ', ' + additionalFrameworks.join(', ');
  }

  return {
    jobRole,
    probability,
    additionalSkills: additionalSkills.join(', ') || 'None',
    additionalFrameworks: additionalFrameworks.join(', ') || 'None',
    feedback,
  };
}
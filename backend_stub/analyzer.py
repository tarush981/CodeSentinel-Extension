import ast
import re
from typing import List

def analyze_code(code: str, language: str) -> dict:
    """
    Layer 1: Fast Rule-Based Analyzer.
    Output: { "features": ["dict_init", "nested_loop", ...], "confidence": float, "concept": str }
    """
    lang = language.lower() if language else "python"
    
    if lang == "python":
        return _analyze_python_ast(code)
    else:
        return _analyze_regex_heuristics(code)

def _analyze_python_ast(code: str) -> dict:
    features = set()
    
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return _analyze_regex_heuristics(code)  # Fallback if invalid snippet
        
    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.current_depth = 0
            self.func_name = None

        def visit_FunctionDef(self, node):
            self.func_name = node.name
            features.add("function_def")
            self.generic_visit(node)

        def visit_Call(self, node):
            if isinstance(node.func, ast.Name):
                if self.func_name and node.func.id == self.func_name:
                    features.add("recursion")
                if node.func.id == "set":
                    features.add("set_init")
                if node.func.id == "dict":
                    features.add("dict_init")
                if node.func.id == "list":
                    features.add("list_init")
                if node.func.id == "sorted":
                    features.add("sorting")
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr == "append":
                    features.add("append_operation")
                if node.func.attr == "sort":
                    features.add("sorting")
            self.generic_visit(node)

        def visit_Dict(self, node):
            features.add("dict_init")
            self.generic_visit(node)

        def visit_Set(self, node):
            features.add("set_init")
            self.generic_visit(node)
            
        def visit_List(self, node):
            features.add("list_init")
            self.generic_visit(node)

        def visit_For(self, node):
            features.add("loop")
            self.current_depth += 1
            if self.current_depth > 1:
                features.add("nested_loop")
            self.generic_visit(node)
            self.current_depth -= 1

        def visit_While(self, node):
            features.add("while_loop")
            self.current_depth += 1
            if self.current_depth > 1:
                features.add("nested_loop")
            self.generic_visit(node)
            self.current_depth -= 1
            
        def visit_Compare(self, node):
            features.add("condition_compare")
            self.generic_visit(node)
            
        def visit_Subscript(self, node):
            features.add("indexing")
            self.generic_visit(node)
            
        def visit_Break(self, node):
            features.add("break_statement")
            self.generic_visit(node)

    visitor = Visitor()
    visitor.visit(tree)
    
    code_lower = code.lower()
    if 'low' in code_lower and 'high' in code_lower and 'mid' in code_lower and ('+' in code_lower and '/' in code_lower):
        features.add("binary_search_mid")
        
    features_list = list(features)
    
    # Meaningful check - did we find something substantial enough for a structural question?
    substantial_features = [f for f in features_list if f not in ["condition_compare", "indexing", "function_def"]]
    confidence = 0.9 if substantial_features else 0.4
    
    primary_concept = substantial_features[0] if substantial_features else "generic"

    return {
        "features": features_list,
        "concept": primary_concept,
        "confidence": confidence,
        "complexity": "O(?)" # removed explicit complexity from Layer 1; Groq will reason it
    }

def _analyze_regex_heuristics(code: str) -> dict:
    code_lower = code.lower()
    features = set()
    
    # Loops
    loop_matches = len(re.findall(r'(for|while)\s*\(', code_lower))
    if loop_matches > 0:
        features.add("loop")
        if loop_matches >= 2:
            features.add("nested_loop")
            
    if 'while ' in code_lower or 'while(' in code_lower:
        features.add("while_loop")
        
    # Recursion (crude)
    if re.search(r'function\s+(\w+).*?\{\s*.*?\b\1\s*\(', code_lower, re.DOTALL) or re.search(r'(?:public|private|protected)?\s*\w+\s+(\w+)\s*\(.*?\s*\{.*?\b\1\s*\(', code_lower, re.DOTALL):
        features.add("recursion")

    # Data Structures
    if 'new map' in code_lower or 'hashmap' in code_lower or 'unordered_map' in code_lower or 'map<' in code_lower or '{}' in code_lower:
        features.add("dict_init")
    if 'new set' in code_lower or 'unordered_set' in code_lower or 'set<' in code_lower:
        features.add("set_init")
    if '[]' in code_lower or 'new array' in code_lower or 'list<' in code_lower or 'vector<' in code_lower or 'arraylist<' in code_lower:
        features.add("list_init")
        
    # Ops
    if '.push(' in code_lower or '.add(' in code_lower or '.append(' in code_lower or 'push_back(' in code_lower:
        features.add("append_operation")
    if '.sort(' in code_lower or 'collections.sort(' in code_lower or re.search(r'\bsort\(', code_lower):
        features.add("sorting")
    if '.contains(' in code_lower or re.search(r'\bfind\(', code_lower):
        features.add("linear_search")
    if 'break;' in code_lower or 'break ' in code_lower:
        features.add("break_statement")
    if '>' in code_lower or '<' in code_lower or '==' in code_lower:
        features.add("condition_compare")
    if '[' in code_lower and ']' in code_lower:
        features.add("indexing")
        
    if 'low' in code_lower and 'high' in code_lower and 'mid' in code_lower and '/' in code_lower:
        features.add("binary_search_mid")
        
    features_list = list(features)
    substantial_features = [f for f in features_list if f not in ["condition_compare", "indexing", "function_def"]]
    confidence = 0.85 if substantial_features else 0.4
    primary_concept = substantial_features[0] if substantial_features else "generic"
        
    return {
        "features": features_list,
        "concept": primary_concept,
        "confidence": confidence,
        "complexity": "O(?)" 
    }

# Local test
if __name__ == "__main__":
    test_code = """
    arr = []
    for i in range(n):
        arr.append(i * 2)
    """
    print(analyze_code(test_code, "python"))

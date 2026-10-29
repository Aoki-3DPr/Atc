#pragma once
#include <iostream>

using namespace std;

class Treap {
private:
	int size;
	class Node {
	public:
		int priority;
		int key;
		Node* left;
		Node* right;
		Node(int k) : key(k), priority(rand()), left(nullptr), right(nullptr) {};
		Node* add(int k) {
			if (this->key < k) {
				if (this->right == nullptr) {
					this->right = new Node(k);
					if (this->priority < this->right->priority) {
						return rotateR();
					}
				} else {
					right = right->add(k);
					if (this->priority < this->right->priority) {
						return rotateR();
					}
				}
			} else if (this->key > k) {
				if (this->left == nullptr) {
					this->left = new Node(k);
					if (this->priority < this->left->priority) {
						return rotateL();
					}
				} else {
					left = left->add(k);
					if (this->priority < this->left->priority) {
						return rotateL();
					}
				}
			}
			return this;
		}

		Node* rotateremove() {
			if (this->left == nullptr) {
				return this->right;
			}
			if (this->right == nullptr) {
				return this->left;
			}
			Node* newThis;
			if (this->left->priority > this->right->priority) {
				newThis = rotateL();
				newThis->right = newThis->right->rotateremove();
				return newThis;
			} else if (this->left->priority < this->right->priority) {
				newThis = rotateR();
				newThis->left = newThis->left->rotateremove();
				return newThis;
			}
		}


		Node* remove(int k) {
			Node* temp;
			if (this->key < k) {
				if (this->right != nullptr) {
					this->right = this->right->remove(k);
				}
				return this;
			} else if (this->key > k) {
				if (this->left != nullptr) {
					this->left = this->left->remove(k);
				}
				return this;
			}
			return rotateremove();
		}

		void print_binary() {
			if (this->right != nullptr) {
				this->right->print_binary();
			}
			cout << this->key << " ";
			if (this->left != nullptr) {
				this->left->print_binary();
			}
			return;

		}

		Node* rotateL() {
			Node* newRoot = this->left;
			this->left = newRoot->right;
			newRoot->right = this;
			return newRoot;
		}

		Node* rotateR() {
			Node* newRoot = this->right;
			this->right = newRoot->left;
			newRoot->left = this;
			return newRoot;
		}
	};
	Node* root;

public:
	Treap() : size(0), root(nullptr) {}
	void add(int key) {
		if (root == nullptr) {
			root = new Node(key);
			size++;
			return;
		}
		root = root->add(key);
	}

	void remove(int k) {
		if (root == nullptr) {
			return;
		}
		root = root->remove(k);
	}

	int maxnum() {
		Node* temp = root;
		while (temp->right != nullptr) {
			temp = temp->right;
		}
		return temp->key;
	}

	void print() {
		root->print_binary();
	}
};


#ifdef BUILDING_LIB_STANDALONE
int main() {
	Treap* treap = new Treap();
	for (int i = 0;i < 1000;i++) {
		treap->add(rand() % 1000);
	}
	for (int i = 0;i < 1000;i++) {
		treap->remove(rand() % 1000);
	}
	treap->print();
}
#endif

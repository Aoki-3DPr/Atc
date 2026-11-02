#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	string s; cin >> s;
	ll c = 0;
	for (ll i = 0; i < s.size(); i++) {
		if (s[i] == 'o') {
			c++;
		}
	}
	if (c % 2 == 0) {
		cout << "even" << endl;
	} else {
		cout << "odd" << endl;
	}
	return 0;
}

int main() {
	solve();
    return 0;
}


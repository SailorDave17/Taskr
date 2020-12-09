package com.taskr.core.storage;

import com.taskr.core.model.Task;
import com.taskr.core.model.User;
import com.taskr.core.storage.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserStorage {
    private UserRepository userRepo;

    public UserStorage(UserRepository userRepo) {
        this.userRepo = userRepo;
    }

    public void save(User user) {
        userRepo.save(user);
    }

    public void deleteById(Long id) {
        userRepo.deleteById(id);
    }

    public void updateUserTimeCommitment(User user) {
        int userTotalAvailableTime = user.getTotalAvailableTime();
        int userTaskLoad = 0;
        for (Task task : user.getTaskList()) {
            userTaskLoad += task.getActualWorkTime();
        }
        user.setCommittedTime(userTaskLoad);
        int userRemainingAvailableTime = userTotalAvailableTime - userTaskLoad;
        user.setRemainingAvailableTime(userRemainingAvailableTime);
    }

    public void updateUserTaskCount(User user) {
        int userTaskCount = user.getTaskList().size();
        int userTasksCompleted = 0;
        for (Task task : user.getTaskList()) {
            if (task.isDone()) {
                userTasksCompleted += 1;
            }
        }
        user.setNumberTasksAssigned(userTaskCount);
        user.setNumberTasksComplete(userTasksCompleted);
    }

    public void updateUser(User user) {
        updateUserTimeCommitment(user);
        updateUserTaskCount(user);
    }

    public Iterable<User> findAll() {
        return userRepo.findAll();
    }

    public User findById(Long id) {
        if (userRepo.findById(id).isPresent()) {
            return userRepo.findById(id).get();
        } else return new User("Dummy user");
    }

}
